# Team chat

Internal chat for SampTrek staff (Super Admin, admins, project managers, sales and viewers) to share project
updates and talk to each other. It runs on your own SampTrek server: there is no outside chat service, no extra
account and nothing to set up in Settings → Integrations. Client and vendor portal users never see it.

Menu: **Work → Team chat** (`/chat`). The menu item shows how many messages are unread.

## Who gets chat

Chat is controlled in layers, like every other feature (docs/FEATURE_ACCESS.md):

1. **Super Admin.** Team chat is part of a plan (Professional and Enterprise by default) or given to one
   organisation as an extra (Super Admin → Organisations → Features). The Super Admin can also take it away from one
   person, an admin included (Organisations → People). The organisation that runs the server always has it.
2. **Admins.** When the organisation has chat, its admins get it first, with every option. Nobody else has it yet.
3. **Users.** An admin turns it on for their users in **Settings → Features & access**: everyone, chosen people,
   admins only, or no one. Each option is its own switch there, given the same way:

| Switch | What it allows |
| --- | --- |
| `chat` Team chat | Use chat: read Announcements and General, and any group someone adds you to |
| `chat.general` Post in General | Write in General |
| `chat.project_rooms` Project rooms | See, open and post in project rooms |
| `chat.groups` Make groups | Start group conversations |
| `chat.direct` Direct messages | Message one person; you can only message people who have it too |

Announcements are always posted by admins and the Super Admin only. Someone without chat does not see Team chat in
the menu, and the server refuses its API (`403 FEATURE_DISABLED`). Options are checked by the server on every request.

## Conversations

| Kind | Who sees it | Who posts |
| --- | --- | --- |
| **Announcements** | Everyone on the team | Admins and the Super Admin only |
| **General** | Everyone on the team | Everyone (admins can lock it to admins only) |
| **Project room** | Everyone on the team. One per project, made the first time someone opens it (New → Project room, or `/chat?project=<id>`) | Everyone (admins can lock it); admins can archive it |
| **Group** | Only its members | Its members. The person who made it, or an admin, adds people; anyone can leave |
| **Direct message** | Only the two people | The two people |

Admins do not see other people's direct messages or groups they are not in.

- **Project updates.** In a project room, tick *Post as a project update* and pick *On track*, *At risk*,
  *Blocked* or *Done*. The update shows as a coloured card, so it stands out from normal chat.
- **Edit and delete.** People edit and delete their own messages. Admins can delete anyone's message (recorded in
  the audit log).
- **Mute** a conversation for yourself from the ⋯ menu; muted conversations do not count in the menu badge.
- **Badges.** The Super Admin and admins carry a badge next to their name. A green dot shows who has SampTrek open.

## Working offline

The chat keeps working when the connection drops:

1. **Reading.** The last 150 messages of each conversation are saved in the browser (local storage), so they
   stay readable while offline. The header says *Offline* and a yellow note explains it.
2. **Writing.** A message written offline goes into an outbox on the device and shows *Waiting for a connection*.
   When the connection comes back, the outbox is sent in order, from any SampTrek page.
3. **No doubles.** Every message gets an id on the device (`clientId`). If the same message is sent twice (for
   example the connection dropped just after sending), the server saves it once.
4. **Catching up.** Every message has a growing number (`seq`). After reconnecting, the device asks for everything
   after the last number it has, plus edits and deletions since its last sync.
5. **Refused messages** (for example a room that was locked meanwhile) show *Not sent* with *Try again* and *Discard*.

Signing out removes the saved chat from that browser. Opening SampTrek from scratch while offline needs the page to
be cached by the browser; that part (an installable app with a service worker) is not included yet.

## How it works

- **Live updates**: Server-Sent Events, `GET /api/v1/chat/stream` (one connection per open tab, a ping every 25 s).
  The browser reconnects by itself; the app also catches up once a minute as a safety net.
- **Several API processes**: the live stream is in-process. With more than one API process behind a load
  balancer, messages still arrive through the one-minute catch-up; for instant delivery across processes, run one
  API process or add Redis pub/sub (Redis is already in docker-compose).
- **Feature switches**: `chat`, `chat.general`, `chat.project_rooms`, `chat.groups`, `chat.direct` (web only for now). See *Who gets chat*.

### API (staff only)

| Method | Path | What |
| --- | --- | --- |
| GET | `/chat/channels` | Conversations this person can see, with unread counts and the last message |
| GET | `/chat/channels/:id` | One conversation |
| PATCH | `/chat/channels/:id` | `muted` (anyone, for themselves); `adminsOnly`, `archived`, `name` (admins; group maker for groups) |
| POST | `/chat/direct` | `{ userId }`: open (or make) the direct conversation with that person |
| POST | `/chat/groups` | `{ name, userIds }` |
| POST | `/chat/channels/:id/members` | `{ userIds }` add people to a group |
| DELETE | `/chat/channels/:id/members/me` | Leave a group |
| POST | `/chat/projects/:projectId` | Open (or make) the project room |
| GET | `/chat/channels/:id/messages` | `?before=<seq>` older page, `?after=<seq>` newer; 50 at a time |
| POST | `/chat/channels/:id/messages` | `{ body, clientId?, type?: TEXT\|UPDATE, tone? }` |
| POST | `/chat/channels/:id/read` | `{ seq }` read up to here (only moves forward) |
| PATCH / DELETE | `/chat/messages/:id` | Edit / delete |
| GET | `/chat/sync` | `?after=<seq>&changedSince=<ISO time>`: what this device missed (500 at a time, `more` when there is more) |
| GET | `/chat/me` | `{ enabled, options }`: what this person may do in chat |
| GET | `/chat/people` | Teammates who have chat, with `online` and `direct` |
| GET (SSE) | `/chat/stream` | Events: `hello`, `message`, `channel`, `read`, `presence`, `ping` |

Tables: `ChatChannel`, `ChatMember` (members of groups and direct messages, and everyone's read position),
`ChatMessage` (migration `20261110120000_team_chat`). Code: `apps/api/src/chat/chat.ts`,
`apps/web/components/chat/chat-provider.tsx`, `apps/web/app/(app)/chat/page.tsx`. Tests: `test/e2e/chat.e2e.spec.ts`.

Project comments with @mentions and handovers live on the project's Team tab (docs/TEAM_COLLABORATION.md);
team chat is for conversation, not for the project's record.
