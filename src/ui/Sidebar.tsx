import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Conversation, Page } from "@/core/store";
import { useApp } from "@/core/store";
import { useRuntime } from "@/models/runtime";
import { useAccount } from "@/core/account";
import { isDecisionModel } from "@/models/decide";
import { AccountDialog } from "./Account";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { SPRING, SPRING_SNAP } from "./motion";

/** Where people go every day. */
const NAV: Array<{ page: Page; label: string; icon: keyof typeof Icon }> = [
  { page: "models", label: "Model hub", icon: "grid" },
  { page: "arena", label: "Arena", icon: "chart" },
  { page: "tune", label: "Train", icon: "brain" },
  { page: "projects", label: "Projects", icon: "folder" },
];

/** Everything else, one click further, so the recent chats get the room. */
const MORE: Array<{ page: Page; label: string; icon: keyof typeof Icon }> = [
  { page: "scheduled", label: "Scheduled", icon: "clock" },
  { page: "agents", label: "Agents", icon: "terminal" },
  { page: "decide", label: "Decisions", icon: "bolt" },
  { page: "store", label: "Store", icon: "store" },
  { page: "companion", label: "Companion", icon: "sparkle" },
  { page: "api", label: "API", icon: "globe" },
];

const MORE_KEY = "conduit.nav.more";

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
  const library = useRuntime((s) => s.library);
  const hasDecision = Boolean(loaded?.decision) || library.some((e) => isDecisionModel(e.repo));
  const account = useAccount((s) => s.session);
  const more = MORE.filter((item) => item.page !== "decide" || hasDecision);
  const inMore = more.some((item) => item.page === page);
  const [moreOpen, setMoreOpen] = useState(() => {
    try {
      return localStorage.getItem(MORE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleMore = () => {
    const next = !moreOpen;
    setMoreOpen(next);
    try {
      localStorage.setItem(MORE_KEY, next ? "1" : "0");
    } catch {
      /* a remembered preference, nothing more */
    }
  };

  const groups = useMemo(() => groupByAge(conversations, query), [conversations, query]);
  // A deleted chat can be brought back for a few seconds: one stray click on a
  // trash icon should never cost a conversation.
  const [deleted, setDeleted] = useState<{ convo: Conversation; index: number } | null>(null);
  useEffect(() => {
    if (!deleted) return;
    const t = window.setTimeout(() => setDeleted(null), 7000);
    return () => window.clearTimeout(t);
  }, [deleted]);

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
          <span className="nav__name">Conduit</span>
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
        <button
          className="navitem navmore"
          aria-expanded={moreOpen}
          aria-label={moreOpen ? "Show fewer pages" : "Show more pages"}
          title={moreOpen ? "Less" : "More"}
          onPointerDown={() => toggleMore()}
        >
          <span className="navitem__row">
            <Icon.chevron />
            <span className="navitem__label">{moreOpen ? "Less" : "More"}</span>
            {!moreOpen && inMore && <span className="navitem__live" aria-label="The open page is in here" />}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {moreOpen && (
            <motion.div
              className="navmore__list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING_SNAP}
            >
              {more.map((item) => (
                <NavItem
                  key={item.page}
                  active={page === item.page}
                  icon={item.icon}
                  label={item.label}
                  onSelect={() => setPage(item.page)}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <div className="nav__recents">
        <div className="nav__label">Recents</div>
        {groups.length === 0 && (
          <div className="nav__empty">{query ? "Nothing matches." : "No chats yet"}</div>
        )}
        {groups.map((group) => (
          <div key={group.label} className="nav__group">
            {groups.length > 1 && <div className="nav__sublabel">{group.label}</div>}
            {group.items.map((convo) => (
              <RecentRow
                key={convo.id}
                convo={convo}
                active={page === "chat" && convo.id === activeId}
                onSelect={() => select(convo.id)}
                onDelete={() => {
                  const index = conversations.findIndex((c) => c.id === convo.id);
                  remove(convo.id);
                  setDeleted({ convo, index });
                }}
              />
            ))}
          </div>
        ))}
      </div>

      <AnimatePresence>
        {deleted && (
          <motion.div
            className="undo-toast"
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={SPRING_SNAP}
          >
            <span>Chat deleted</span>
            <button
              className="linkbtn"
              onPointerDown={() => {
                useApp.getState().restoreConversation(deleted.convo, deleted.index);
                setDeleted(null);
              }}
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="nav__foot">
        <button
          className="me me--btn"
          aria-label={account ? "Account" : "Sign in"}
          title={account ? account.user.email : "Sign in"}
          onPointerDown={() => setAccountOpen(true)}
        >
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
    <button className="navitem" aria-current={active} aria-label={label} title={label} onPointerDown={onSelect}>
      {active && <motion.span layoutId="nav-pill" className="navitem__pill" transition={SPRING} />}
      <span className="navitem__row">
        <Glyph />
        <span className="navitem__label">{label}</span>
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
    { label: "Pinned", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This week", items: [] },
    { label: "Older", items: [] },
  ];

  for (const convo of matching) {
    const age = now - convo.at;
    if (convo.pinned) buckets[0].items.push(convo);
    else if (age < DAY) buckets[1].items.push(convo);
    else if (age < DAY * 2) buckets[2].items.push(convo);
    else if (age < DAY * 7) buckets[3].items.push(convo);
    else buckets[4].items.push(convo);
  }

  return buckets.filter((b) => b.items.length > 0);
}

/**
 * One chat in the sidebar.
 *
 * Double-click the name (or the pencil) to rename it in place; Enter keeps
 * the new name, Escape keeps the old one. Pin and delete sit on the right and
 * only appear on hover, so a long list stays a list of names.
 */
function RecentRow({
  convo,
  active,
  onSelect,
  onDelete,
}: {
  convo: Conversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(convo.title);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setDraft(convo.title);
      requestAnimationFrame(() => input.current?.select());
    }
  }, [renaming, convo.title]);

  const commit = () => {
    if (draft.trim() && draft.trim() !== convo.title) useApp.getState().renameConversation(convo.id, draft);
    setRenaming(false);
  };

  if (renaming) {
    return (
      <div className="recent recent--editing">
        <input
          ref={input}
          className="recent__input"
          value={draft}
          aria-label="Chat name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      </div>
    );
  }

  const act = (e: React.PointerEvent, run: () => void) => {
    e.stopPropagation();
    run();
  };

  return (
    <button className="recent" aria-current={active} onPointerDown={onSelect} onDoubleClick={() => setRenaming(true)} title={convo.title}>
      {active && <motion.span layoutId="recent-pill" className="recent__pill" transition={SPRING} />}
      {convo.pinned && <span className="recent__pin" aria-label="Pinned" />}
      <span className="recent__label">{convo.title}</span>
      <span className="recent__acts">
        <span
          className="recent__del"
          role="button"
          aria-label={convo.pinned ? "Unpin chat" : "Pin chat"}
          title={convo.pinned ? "Unpin" : "Pin"}
          onPointerDown={(e) => act(e, () => useApp.getState().togglePin(convo.id))}
        >
          <Icon.bookmark />
        </span>
        <span
          className="recent__del"
          role="button"
          aria-label="Rename chat"
          title="Rename"
          onPointerDown={(e) => act(e, () => setRenaming(true))}
        >
          <Icon.compose />
        </span>
        <span
          className="recent__del recent__del--danger"
          role="button"
          aria-label="Delete chat"
          title="Delete"
          onPointerDown={(e) => act(e, onDelete)}
        >
          <Icon.trash />
        </span>
      </span>
    </button>
  );
}
