# Automation Notifications Manager Card

A Home Assistant Dashboard card that finds **every notification your automations send** and puts them all in one place — grouped by automation, searchable, and fully editable. Stop opening automations one at a time to fix a typo, retarget a device, or reword an alert.

* **Discovers every `notify.*` action** in your automations — even ones buried inside `choose`, `if / then / else`, `repeat`, and `parallel` blocks
* **Edit any part inline** — target, title, message, and platform options — with a confirmation prompt and an explicit Save
* **Everything in the card** — no YAML required; templates shown raw or rendered live

https://github.com/Ltek/notification-manager-card

Current build: **v2026.09.08.1**

---

## What's new (2026-09-08)

- **First release.** Browse and edit the notify actions embedded across all your automations, grouped by automation, with live filters and per-column show/hide.

---

## How it works

Home Assistant doesn't expose an automation's actions as entity state — only its on/off state and a few attributes. This card reads each automation's **full configuration** through Home Assistant's own REST config API (the same mechanism the built-in automation editor uses), walks the action tree to find every notify call, and shows them to you. When you save an edit, it writes only the notification you changed back into the automation and reloads automations — every other action and branch is preserved exactly.

- **Storage (UI) automations are editable.** Automations you created in the UI can be edited and saved from the card.
- **YAML / package automations are read-only.** Automations defined in YAML files or packages can't be written through the API, so they're shown locked (with a 🔒) rather than editable. *(Whether they appear at all depends on your setup — the card can only read what the API exposes.)*
- **Nothing is stored in the card.** The card's own configuration is just your view preferences (columns, filters, defaults). Your notifications always live in your automations — the single source of truth.

---

## Options at a glance

Every option below is fully point-and-click — no YAML required.

### Grouping & browsing
- **Grouped by automation** — each automation is a collapsible group, with its notifications listed as rows beneath it. An automation with several notify calls shows them all together.
- **Live status** — each group shows the automation's on/off state and when it last triggered, updated live.
- **Show / hide any column** — Target, Title, Message, plus optional Last triggered and Enabled columns; toggle them from the card's column menu.

### Filtering
- **Filter by notify target** — e.g. show only automations that message `parent_phones` — while still showing *all* the notifications nested in each matching automation.
- **Filter by automation name, on/off state, "has a title," or "editable only."** Filters are a view over your data; they never change anything.

### Editing
- **Per-row Edit button** unlocks that notification's fields; nothing is editable until you choose to edit.
- **Edit every part** — the target `notify.*` service, the title, the message, and the nested platform options (`data`) that iOS/Android and other integrations use.
- **Dirty indicator + Save** — an edited-but-unsaved notification is clearly marked, and a **Save** button appears only when there's something to save.
- **Confirmation before every write** — saving explains that it will rewrite and reload the automation (which may re-trigger a live automation) and asks you to confirm.
- **Surgical, non-destructive saves** — only the notification you edited is changed; the rest of the automation — conditions, other actions, and nested branches — is left byte-for-byte intact. Multiple edits within one automation are saved together in a single write.

### Templates
- **Raw by default** — messages and titles are shown exactly as written, Jinja templates and all.
- **Live-render toggle** — flip it on to see what each templated title/message *actually says right now*, updated live as the underlying entities change. Template errors show inline without breaking the card.

---

## Installation

1. Create the folder `\config\www\community\notification-manager-card`.
2. Download the card's `.js` file from [the repository](https://github.com/Ltek/notification-manager-card) and place it in that folder.
3. Add it as a Dashboard resource:
   - **Settings → Dashboards → ⋮ → Resources → Add Resource**
   - URL: `/local/community/notification-manager-card/automation-notifications-manager-card.js`  ·  Type: **JavaScript Module**
4. Clear your browser cache and hard-refresh.

Then add the card from the card picker (**Automation Notifications Manager Card**), or in YAML:

```yaml
type: custom:automation-notifications-manager-card
```

> **Note:** the Dashboard card type is `custom:automation-notifications-manager-card`. Editing notifications requires an **admin** account (the same permission Home Assistant requires to edit automations).

---

## Screenshots

<!-- SCREENSHOTS:START -->
<!-- SCREENSHOTS:END -->
