use crate::error::AppResult;

const SERVICE: &str = "DBSage";

pub fn set_password(profile_id: &str, password: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE, profile_id)?;
    entry.set_password(password)?;
    Ok(())
}

pub fn get_password(profile_id: &str) -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(SERVICE, profile_id)?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_password(profile_id: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE, profile_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
