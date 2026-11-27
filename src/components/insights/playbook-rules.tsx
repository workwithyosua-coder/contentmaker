"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/app/insights/actions";
import { LESSON_CATEGORIES, SOURCE_LABEL, type LessonSource } from "@/lib/insights/playbook";

type Rule = { id: string; category: string; rule_text: string; source: LessonSource; status: "active" | "paused"; evidence_count: number };

/** One playbook rule: source and category labels, Pause / Resume, inline Edit (Escape cancels), Delete. */
function RuleRow({
  rule,
  atCap,
  setStatus,
  edit,
  remove,
}: {
  rule: Rule;
  atCap: boolean;
  setStatus: (id: string, s: "active" | "paused") => Promise<ActionResult>;
  edit: (id: string, text: string, category: string) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(rule.rule_text);
  const [category, setCategory] = useState(rule.category);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const editRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
    else if (wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const run = (p: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await p();
      setMsg(r.ok ? null : r);
      if (r.ok) after?.();
    });
  const cancel = () => {
    setText(rule.rule_text);
    setCategory(rule.category);
    setEditing(false);
  };
  const paused = rule.status === "paused";
  return (
    <li className={`space-y-2 rounded-card border border-border p-3 ${paused ? "opacity-80" : ""}`} data-rule={rule.id} data-status={rule.status}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="stamp" style={{ color: rule.source === "owner_feedback" ? "var(--good)" : "var(--early)", background: rule.source === "owner_feedback" ? "var(--good-bg)" : "var(--early-bg)" }}>
          {SOURCE_LABEL[rule.source]}
        </span>
        <span className="stamp" style={{ color: "var(--avg)", background: "var(--avg-bg)" }}>
          {rule.category}
        </span>
        {paused && <span className="text-muted">Paused</span>}
        <span className="tabular-nums text-muted">
          {rule.evidence_count} {rule.evidence_count === 1 ? "signal" : "signals"}
        </span>
      </div>
      {editing ? (
        <div
          className="space-y-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
        >
          <label htmlFor={`rule-${rule.id}`} className="block text-sm font-semibold">
            Rule text
          </label>
          <textarea id={`rule-${rule.id}`} ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={200} className="field min-h-16" />
          <label htmlFor={`cat-${rule.id}`} className="block text-sm font-semibold">
            Category
          </label>
          <select id={`cat-${rule.id}`} value={category} onChange={(e) => setCategory(e.target.value)} className="field">
            {LESSON_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(() => edit(rule.id, text, category), () => setEditing(false))}>
              {pending ? "Saving..." : "Save rule"}
            </button>
            <button type="button" className="btn btn-quiet" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm">{rule.rule_text}</p>
      )}
      {!editing && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending || (paused && atCap)}
            title={paused && atCap ? "12 rules are active. Pause or delete one first." : undefined}
            onClick={() => run(() => setStatus(rule.id, paused ? "active" : "paused"))}
            data-rule-toggle
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button ref={editRef} type="button" className="btn btn-secondary" disabled={pending} onClick={() => setEditing(true)} data-rule-edit>
            Edit
          </button>
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => run(() => remove(rule.id))} data-rule-delete aria-label={`Delete rule: ${rule.rule_text}`}>
            Delete
          </button>
        </div>
      )}
      {msg && !msg.ok && (
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {msg.message}
        </p>
      )}
    </li>
  );
}

export function PlaybookRules({
  rules,
  cap,
  setStatus,
  edit,
  remove,
}: {
  rules: Rule[];
  cap: number;
  setStatus: (id: string, s: "active" | "paused") => Promise<ActionResult>;
  edit: (id: string, text: string, category: string) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
}) {
  const active = rules.filter((r) => r.status === "active").length;
  return (
    <ul className="space-y-2">
      {rules.map((r) => (
        <RuleRow key={`${r.id}-${r.rule_text}-${r.category}-${r.status}`} rule={r} atCap={active >= cap} setStatus={setStatus} edit={edit} remove={remove} />
      ))}
    </ul>
  );
}
