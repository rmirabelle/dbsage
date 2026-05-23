use crate::error::{AppError, AppResult};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};

/**
 * On-disk envelope for a passphrase-encrypted blob. The plaintext (a JSON
 * state bundle) is encrypted with XChaCha20-Poly1305 under a key derived from
 * the user's passphrase via Argon2id. Everything needed to re-derive the key
 * and decrypt — except the passphrase — lives in this struct, so it is fully
 * self-describing across machines and future versions.
 */
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedFile {
    pub app: String,
    pub format: String,
    pub version: u32,
    pub kdf: KdfParams,
    pub cipher: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    pub algo: String,
    pub salt: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

pub const APP_TAG: &str = "DBSage";
pub const ENCRYPTED_FORMAT: &str = "dbsage-state-encrypted";
const ENCRYPTED_VERSION: u32 = 1;
const CIPHER_TAG: &str = "xchacha20poly1305";

/** Argon2id cost parameters. 64 MiB / 3 passes / 1 lane — comfortably above the
 * OWASP minimum while staying responsive on a desktop. */
const M_COST: u32 = 65_536;
const T_COST: u32 = 3;
const P_COST: u32 = 1;

fn derive_key(passphrase: &str, salt: &[u8], params: &KdfParams) -> AppResult<[u8; 32]> {
    if params.algo != "argon2id" {
        return Err(AppError::Other(format!(
            "unsupported key-derivation algorithm: {}",
            params.algo
        )));
    }
    let argon_params = Params::new(params.m_cost, params.t_cost, params.p_cost, Some(32))
        .map_err(|e| AppError::Other(format!("invalid Argon2 parameters: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let mut key = [0u8; 32];
    argon
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::Other(format!("key derivation failed: {e}")))?;
    Ok(key)
}

pub fn encrypt(plaintext: &[u8], passphrase: &str) -> AppResult<EncryptedFile> {
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

    let kdf = KdfParams {
        algo: "argon2id".to_string(),
        salt: B64.encode(salt),
        m_cost: M_COST,
        t_cost: T_COST,
        p_cost: P_COST,
    };
    let key = derive_key(passphrase, &salt, &kdf)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| AppError::Other(format!("cipher init failed: {e}")))?;
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|_| AppError::Other("encryption failed".to_string()))?;

    Ok(EncryptedFile {
        app: APP_TAG.to_string(),
        format: ENCRYPTED_FORMAT.to_string(),
        version: ENCRYPTED_VERSION,
        kdf,
        cipher: CIPHER_TAG.to_string(),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    })
}

pub fn decrypt(file: &EncryptedFile, passphrase: &str) -> AppResult<Vec<u8>> {
    if file.cipher != CIPHER_TAG {
        return Err(AppError::Other(format!(
            "unsupported cipher: {}",
            file.cipher
        )));
    }
    let salt = B64
        .decode(&file.kdf.salt)
        .map_err(|_| AppError::Other("corrupted file: bad salt".to_string()))?;
    let nonce = B64
        .decode(&file.nonce)
        .map_err(|_| AppError::Other("corrupted file: bad nonce".to_string()))?;
    let ciphertext = B64
        .decode(&file.ciphertext)
        .map_err(|_| AppError::Other("corrupted file: bad ciphertext".to_string()))?;

    let key = derive_key(passphrase, &salt, &file.kdf)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| AppError::Other(format!("cipher init failed: {e}")))?;
    cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| AppError::Other("incorrect passphrase or corrupted file".to_string()))
}
