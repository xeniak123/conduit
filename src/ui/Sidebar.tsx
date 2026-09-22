import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Conversation, Page } from "@/core/store";
import { useApp } from "@/core/store";
import { useRuntime } from "@/models/runtime";
import { useAccount } from "@/core/account";
import { AccountDialog } from "./Account";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { SPRING, SPRING_SNAP } from "./motion";

const NAV: Array<{ page: Page; label: string; icon: keyof typeof Icon }> = [
  { page: "models", label: "Model hub", icon: "grid" },
  { page: "store", label: "Store", icon: "store" },
  { page: "projects", label: "Projects", icon: "folder" },
  { page: "scheduled", label: "Scheduled", icon: "clock" },
  { page: "agents", label: "Agents", icon: "terminal" },
  { page: "companion", label: "Companion", icon: "sparkle" },
  { page: "api", label: "API", icon: "globe" },
];

export function Sidebar() {
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeId);
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);
  const select = useApp((s) => s.selectConversation);
  const remove = useApp((s) => s.deleteConversation);
  const newChat = useApp((s) => s.newConversation);
  const openSettings = useApp((s) => s.setSettingsOpen);
  const loaded = useRuntime((s) => s.loaded);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const account = useAccount((s) => s.session);

  const groups = useMemo(() => groupByAge(conversations, query), [conversations, query]);

  const startChat = () => {
    // Reuse an empty chat instead of stacking up blank ones.
    const current = conversations.find((c) => c.id === activeId);
    if (current && current.messages.length === 0) {
      setPage("chat");
      return;
    }
    newChat();
  };

  return (
    <aside className="nav">
      <div className="nav__top" data-tauri-drag-region>
        <span className="nav__brand">
          <span className="nav__mark">
            <Logo size={16} />
          </span>
          Conduit
        </span>
        <button
          className="nav__icon"
          aria-label="Search chats"
          onPointerDown={() => setSearching((v) => !v)}
        >
          <Icon.search />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {searching && (
          <motion.div
            className="nav__search"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_SNAP}
          >
            <input
              autoFocus
              placeholder="Search chats"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearching(false);
                }
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="nav__list">
        <NavItem
          active={page === "chat"}
          icon="compose"
          label="New chat"
          hint="Ctrl N"
          onSelect={startChat}
        />
        {NAV.map((item) => (
          <NavItem
            key={item.page}
            active={page === item.page}
            icon={item.icon}
            label={item.label}
            badge={item.page === "models" && loaded ? "live" : undefined}
            onSelect={() => setPage(item.page)}
          />
        ))}
      </nav>

      <div className="nav__recents">
        <div className="nav__label">Recents</div>
        {groups.length === 0 && (
          <div className="nav__empty">{query ? "Nothing matches." : "No chats yet"}</div>
        )}
        {groups.map((group) => (
          <div key={group.label} className="nav__group">
            {groups.length > 1 && <div className="nav__sublabel">{group.label}</div>}
            {group.items.map((convo) => {
              const active = page === "chat" && convo.id === activeId;
              return (
                <button
                  key={convo.id}
                  className="recent"
                  aria-current={active}
                  onPointerDown={() => select(convo.id)}
                >
                  {active && (
                    <motion.span layoutId="recent-pill" className="recent__pill" transition={SPRING} />
                  )}
                  <span className="recent__label">{convo.title}</span>
                  <span
                    className="recent__del"
                    role="button"
                    aria-label="Delete chat"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      remove(convo.id);
                    }}
                  >
                    <Icon.trash />
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="nav__foot">
        <button className="me me--btn" onPointerDown={() => setAccountOpen(true)}>
          <span className="me__avatar">
            {account ? account.user.email.slice(0, 1).toUpperCase() : <Logo size={14} />}
          </span>
          <span className="me__text">
            <b>{account ? account.user.email.split("@")[0] : "Sign in"}</b>
            <span>{loaded ? `Running ${loaded.name}` : account ? "Synced across computers" : "Sync across computers"}</span>
          </span>
        </button>
        <AnimatePresence>{accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}</AnimatePresence>
        <button className="nav__icon" aria-label="Settings" onPointerDown={() => openSettings(true)}>
          <Icon.settings />
        </button>
      </div>
    </aside>
  );
}

function NavItem({
  active,
  icon,
  label,
  hint,
  badge,
  onSelect,
}: {
  active: boolean;
  icon: keyof typeof Icon;
  label: string;
  hint?: string;
  badge?: string;
  onSelect: () => void;
}) {
  const Glyph = Icon[icon];
  return (
    <button className="navitem" aria-current={active} onPointerDown={onSelect}>
      {active && <motion.span layoutId="nav-pill" className="navitem__pill" transition={SPRING} />}
      <span className="navitem__row">
        <Glyph />
        {label}
        {badge && <span className="navitem__live" aria-label="A model is running" />}
        {hint && <span className="navitem__hint">{hint}</span>}
      </span>
    </button>
  );
}

const DAY = 86_400_000;

function groupByAge(
  conversations: Conversation[],
  query: string,
): Array<{ label: string; items: Conversation[] }> {
  const q = query.trim().toLowerCase();
  const matching = (q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations)
    // Empty chats are drafts, not history.
    .filter((c) => c.messages.length > 0);

  const now = Date.now();
  const buckets: Array<{ label: string; items: Conversation[] }> = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This week", items: [] },
    { label: "Older", items: [] },
  ];

  for (const convo of matching) {
    const age = now - convo.at;
    if (age < DAY) buckets[0].items.push(convo);
    else if (age < DAY * 2) buckets[1].items.push(convo);
    else if (age < DAY * 7) buckets[2].items.push(convo);
    else buckets[3].items.push(convo);
  }

  return buckets.filter((b) => b.items.length > 0);
}
