import type { ReactNode } from "react";
import { Code, Folder, Funnel, PlugsConnected, ShareNetwork } from "@phosphor-icons/react";
import { STATE_CATEGORIES, type StateSelection } from "../types";
import { ViewsIcon } from "./TableViewPresetMenu";

/** The icon each workspace category uses elsewhere in the app, in its usual color. */
export const CATEGORY_ICONS: Record<keyof StateSelection, ReactNode> = {
  profiles: <PlugsConnected size={15} className="text-zinc-400" />,
  relations: <ShareNetwork size={15} className="text-violet-400" />,
  folders: <Folder size={15} weight="fill" className="text-amber-300" />,
  columnSetups: <Funnel size={15} weight="fill" className="text-amber-400" />,
  tableViewPresets: <ViewsIcon size={15} className="text-emerald-400" />,
  savedQueries: <Code size={15} weight="bold" className="text-emerald-400" />,
};

/** A read-only bordered list of workspace categories, each with its icon. */
export function CategoryList({ keys }: { keys: (keyof StateSelection)[] }) {
  return <ul className="rounded border border-zinc-800 bg-[#1d2029] divide-y divide-zinc-800/70 text-[12px]">
    {STATE_CATEGORIES.filter((category) => keys.includes(category.key)).map(({ key, label }) => (
      <li key={key} className="flex items-center gap-2.5 px-3 py-2 text-zinc-200">
        <span className="shrink-0">{CATEGORY_ICONS[key]}</span>
        <span>{label}</span>
      </li>
    ))}
  </ul>;
}
