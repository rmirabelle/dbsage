import {
  ArrowRight,
  CaretRight,
  Info,
  Key,
  Lightbulb,
  MagnifyingGlass,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  articleSearchText,
  DEFAULT_HELP_ARTICLE,
  findHelpArticle,
  HELP_GROUPS,
  HELP_SCREENSHOTS,
  type HelpBlock,
  type HelpScreenshotLayout,
  type HelpScreenshotId,
} from "../help/helpContent";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function HelpDialog({ open, onClose }: Props) {
  const [articleId, setArticleId] = useState(DEFAULT_HELP_ARTICLE);
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [collapsedSearchGroups, setCollapsedSearchGroups] = useState<Set<string>>(
    () => new Set()
  );
  const contentRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setExpandedGroups(new Set([findHelpArticle(articleId).group.id]));
    setCollapsedSearchGroups(new Set());
  }, [open]);

  useEffect(() => {
    setCollapsedSearchGroups(new Set());
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return HELP_GROUPS;
    return HELP_GROUPS.map((group) => ({
      ...group,
      articles: group.articles.filter((article) =>
        articleSearchText(article).includes(needle)
      ),
    })).filter((group) => group.articles.length > 0);
  }, [query]);

  if (!open) return null;

  const { group, article } = findHelpArticle(articleId);
  const resultCount = filteredGroups.reduce(
    (count, resultGroup) => count + resultGroup.articles.length,
    0
  );

  const selectArticle = (id: string) => {
    setArticleId(id);
    const selectedGroupId = findHelpArticle(id).group.id;
    setExpandedGroups((current) => {
      if (current.has(selectedGroupId)) return current;
      const next = new Set(current);
      next.add(selectedGroupId);
      return next;
    });
    contentRef.current?.scrollTo({ top: 0 });
  };

  const searchActive = query.trim().length > 0;

  const toggleGroup = (id: string) => {
    const update = (current: Set<string>) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    };

    if (searchActive) setCollapsedSearchGroups(update);
    else setExpandedGroups(update);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 p-3 backdrop-blur-sm sm:p-4">
      <div
        data-el="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        className="mx-auto flex h-full w-full max-w-[1680px] flex-col overflow-hidden rounded-xl border border-zinc-700/80 bg-[#1d2029] shadow-2xl shadow-black/70"
      >
        <header className="flex h-14 shrink-0 items-center border-b border-zinc-800 bg-zinc-950 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-lime-400/20 bg-lime-400/10 text-lime-400">
              <Info size={18} weight="bold" />
            </div>
            <div className="min-w-0">
              <h1 id="help-dialog-title" className="text-[15px] font-semibold text-zinc-100">
                DB Sage Help
              </h1>
              <p className="truncate text-[11px] text-zinc-500">
                Guides for connections, data, queries, and relations
              </p>
            </div>
          </div>
          <span className="ml-auto mr-3 hidden rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">
            Esc
          </span>
          <button
            ref={closeRef}
            type="button"
            data-el="help-dialog-close-btn"
            onClick={onClose}
            className="rounded-md p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
            aria-label="Close Help"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Help topics"
            className="flex w-[280px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/70 max-sm:w-[210px]"
          >
            <div className="shrink-0 border-b border-zinc-800/80 p-3">
              <label className="relative block">
                <MagnifyingGlass
                  size={15}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
                />
                <input
                  data-el="help-search-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search help…"
                  aria-label="Search help"
                  className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 pl-8 pr-8 text-[12px] text-zinc-200 transition placeholder:text-zinc-600 focus:border-accent-500"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200"
                  >
                    <X size={13} />
                  </button>
                )}
              </label>
              {query && (
                <div className="mt-2 text-[10px] text-zinc-500">
                  {resultCount} {resultCount === 1 ? "article" : "articles"}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              {filteredGroups.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] leading-relaxed text-zinc-500">
                  No help topics match “{query.trim()}”.
                </div>
              ) : (
                filteredGroups.map((resultGroup) => {
                  const expanded = searchActive
                    ? !collapsedSearchGroups.has(resultGroup.id)
                    : expandedGroups.has(resultGroup.id);
                  const articleListId = `help-group-${resultGroup.id}`;

                  return (
                    <section key={resultGroup.id} className="mb-1 last:mb-0">
                      <h2>
                        <button
                          type="button"
                          data-help-group={resultGroup.id}
                          aria-expanded={expanded}
                          aria-controls={articleListId}
                          onClick={() => toggleGroup(resultGroup.id)}
                          className="group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-500 transition hover:bg-zinc-800/70 hover:text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500"
                        >
                          <CaretRight
                            size={12}
                            weight="bold"
                            className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                          />
                          <span className="min-w-0 flex-1 truncate">{resultGroup.title}</span>
                        </button>
                      </h2>
                      {expanded && (
                        <div id={articleListId} className="mb-2 ml-3 space-y-0.5 border-l border-zinc-800 pl-2">
                          {resultGroup.articles.map((resultArticle) => {
                            const active = resultArticle.id === article.id;
                            return (
                              <button
                                key={resultArticle.id}
                                type="button"
                                data-help-article={resultArticle.id}
                                aria-current={active ? "page" : undefined}
                                onClick={() => selectArticle(resultArticle.id)}
                                className={`group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition ${
                                  active
                                    ? "bg-accent-500/12 font-medium text-accent-300"
                                    : "text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200"
                                }`}
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {resultArticle.title}
                                </span>
                                <ArrowRight
                                  size={12}
                                  className={`shrink-0 ${
                                    active
                                      ? "text-accent-400"
                                      : "text-zinc-700 opacity-0 group-hover:opacity-100"
                                  }`}
                                />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })
              )}
            </div>
          </nav>

          <main ref={contentRef} className="min-w-0 flex-1 overflow-y-auto scroll-smooth">
            <article className="mx-auto max-w-[980px] px-8 pb-20 pt-9 max-sm:px-5">
              <div className="mb-8 border-b border-zinc-800 pb-7">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-400">
                  {group.title}
                </div>
                <h2 className="text-[28px] font-semibold tracking-tight text-zinc-100 max-sm:text-[23px]">
                  {article.title}
                </h2>
                <p className="mt-2 max-w-2xl text-[14px] leading-6 text-zinc-400">
                  {article.summary}
                </p>
              </div>

              <div className="space-y-10">
                {article.sections.map((section) => (
                  <section key={section.title}>
                    <h3 className="mb-3 text-[17px] font-semibold text-zinc-100">
                      {section.title}
                    </h3>
                    <div className="flow-root [&>*+*]:mt-4">
                      {section.blocks.map((block, index) => (
                        <HelpBlockView key={`${block.type}-${index}`} block={block} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </article>
          </main>
        </div>
      </div>
    </div>
  );
}

function HelpBlockView({ block }: { block: HelpBlock }) {
  if (block.type === "paragraph") {
    return <p className="text-[13px] leading-6 text-zinc-300">{block.text}</p>;
  }

  if (block.type === "bullets") {
    return (
      <ul className="space-y-2.5 text-[13px] leading-5 text-zinc-300">
        {block.items.map((item) => (
          <li key={item} className="flex gap-3">
            <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "steps") {
    return (
      <ol start={block.start} className="space-y-3 text-[13px] leading-5 text-zinc-300">
        {block.items.map((item, index) => (
          <li key={item} className="flex gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-[10px] font-bold text-accent-300">
              {(block.start ?? 1) + index}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    );
  }

  if (block.type === "note") {
    const warning = block.tone === "warning";
    return (
      <aside
        className={`flex gap-3 rounded-lg border px-4 py-3 ${
          warning
            ? "border-amber-400/20 bg-amber-400/[0.07]"
            : "border-lime-400/20 bg-lime-400/[0.06]"
        }`}
      >
        {warning ? (
          <Warning size={18} className="mt-0.5 shrink-0 text-amber-400" weight="fill" />
        ) : (
          <Lightbulb size={18} className="mt-0.5 shrink-0 text-lime-400" weight="fill" />
        )}
        <div>
          <div className={`text-[12px] font-semibold ${warning ? "text-amber-300" : "text-lime-300"}`}>
            {block.title}
          </div>
          <p className="mt-1 text-[12px] leading-5 text-zinc-400">{block.text}</p>
        </div>
      </aside>
    );
  }

  if (block.type === "screenshot") {
    return (
      <HelpScreenshot
        id={block.id}
        alt={block.alt}
        caption={block.caption}
        layout={block.layout}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
      {block.items.map(([keys, action]) => (
        <div
          key={keys}
          className="flex items-center gap-4 border-b border-zinc-800/70 px-4 py-2.5 last:border-b-0"
        >
          <Key size={14} className="shrink-0 text-zinc-600" />
          <kbd className="w-32 shrink-0 font-mono text-[11px] font-semibold text-accent-300">
            {keys}
          </kbd>
          <span className="text-[12px] text-zinc-400">{action}</span>
        </div>
      ))}
    </div>
  );
}

function HelpScreenshot({
  id,
  alt,
  caption,
  layout = "auto",
}: {
  id: HelpScreenshotId;
  alt: string;
  caption: string;
  layout?: HelpScreenshotLayout;
}) {
  const [missing, setMissing] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const [deviceScale, setDeviceScale] = useState(() => window.devicePixelRatio || 1);
  const [cacheKey] = useState(() => Date.now().toString(36));
  const spec = HELP_SCREENSHOTS[id];
  const physicalWidth = naturalWidth ?? spec.physicalWidth;
  const cssPixelWidth = physicalWidth / deviceScale;
  const resolvedLayout =
    layout === "auto" ? (cssPixelWidth <= 720 ? "inline-right" : "wide") : layout;

  useEffect(() => {
    setMissing(false);
    setNaturalWidth(null);
  }, [id]);

  useEffect(() => {
    const syncDeviceScale = () => setDeviceScale(window.devicePixelRatio || 1);
    window.addEventListener("resize", syncDeviceScale);
    return () => window.removeEventListener("resize", syncDeviceScale);
  }, []);

  if (missing) return null;

  return (
    <figure
      className={`box-border overflow-hidden rounded-lg border border-zinc-700/70 bg-zinc-950 shadow-lg shadow-black/20 max-sm:float-none max-sm:mx-auto max-sm:max-w-full ${
        resolvedLayout === "inline-left"
          ? "float-left mb-3 mr-5 mt-1 w-[var(--help-shot-width)] max-w-[48%]"
          : resolvedLayout === "inline-right"
            ? "float-right mb-3 ml-5 mt-1 w-[var(--help-shot-width)] max-w-[48%]"
            : "clear-both mx-auto w-[var(--help-shot-width)] max-w-full"
      }`}
      style={
        {
          // PNG dimensions are physical pixels. CSS pixels are logical pixels on
          // a scaled Windows display, so using naturalWidth directly enlarges
          // the screenshot. This conversion is a repository-level invariant.
          "--help-shot-width": `${cssPixelWidth}px`,
        } as CSSProperties
      }
    >
      <div
        className="relative flex w-full items-center justify-center overflow-hidden bg-[#111318] p-2.5"
      >
        <img
          src={`/help/screenshots/${id}.png?v=${cacheKey}`}
          alt={alt}
          onLoad={(event) => {
            const image = event.currentTarget;
            setNaturalWidth(image.naturalWidth);
          }}
          onError={() => setMissing(true)}
          className="block h-auto w-auto max-w-full"
        />
      </div>
      {caption ? (
        <figcaption className="border-t border-zinc-800 px-4 py-3 text-[11px] leading-5 text-zinc-500">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
