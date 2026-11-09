/**
 * Every "i" help icon in the web app reads its words from this one file (docs/HELP_ICONS.md).
 *
 * Each entry answers three questions in plain language for research ops staff:
 *   what  – what the page, tab, section or field is for
 *   how   – how to use it
 *   where – where it applies (which markets, vendors, respondents, reports…)
 *
 * Keys:
 *   page:<route>              a page, by route; ids are written as [id], e.g. page:/projects/[id]
 *   tab:<project tab>         a tab on the project page, e.g. tab:Quotas & monitor
 *   section:<title>           a section (card) by its title, anywhere in the app
 *   section:<route>::<title>  the same title, but only on that page (wins over the general one)
 *   field:<label>             a field by its label; a trailing * and a "(…)" ending are ignored
 *   field:<route>::<label>    the same label, but only on that page
 *   check:<key>               a security check on Create project, e.g. check:geolocation
 *   anything else             an explicit id passed as help="…" (used where a title is not plain text)
 *
 * To change the words, edit the text below. To add an icon, add an entry: pages, plain-text section
 * titles and field labels pick it up by themselves. `pnpm --filter @projexa/web test` checks that
 * every page, every project tab and every id used in the code has an entry.
 */

export interface HelpEntry {
  /** Heading on the card; defaults to the section or field name. */
  title?: string;
  what: string;
  how?: string;
  where?: string;
}

export const HELP: Record<string, HelpEntry> = {
  // ───────────────────────────── Pages ─────────────────────────────
  'page:/': {
    title: 'Dashboard',
    what: 'Your home screen: how many projects are live, in test, on hold or closed, and the clicks, completes and revenue for today, yesterday, the last 7 days and this month.',
    how: 'Click any number to open the list or report behind it. Use Show details for charts, top lists, finance and the project board. Customise moves, resizes or hides panels just for you.',
    where: 'Covers every project in your organisation. Test traffic is never counted.',
  },
  'page:/projects': {
    title: 'Projects',
    what: 'Every project with its status, client, markets, completes against target and link status.',
    how: 'Pick a coloured status tab (Live green, Hold orange, Test blue, Draft grey, Closed red), search or sort, and open a project. Tick Live projects to put them on hold, or Hold projects to set them live; Draft and Test cannot be ticked.',
    where: 'All projects you can see. Project managers and admins can change status; viewers can only look.',
  },
  'page:/projects/new': {
    title: 'Create project',
    what: 'Sets up a new project: client, markets (country + language + target group), LOI, IR, CPI, completes, vendors, gate questions and redirects in one go.',
    how: 'Fill the sections from top to bottom, or start from a template or a client brief. Use Apply to all to copy a value to every market. The form saves a draft as you type.',
    where: 'The project starts in Test, so nothing is live until you set a market live on the project page.',
  },
  'page:/projects/[id]': {
    title: 'Project',
    what: 'One project and everything about its fieldwork: markets, vendors and links, quotas, security, respondent pages, redirects, monitoring and finance, each in its own tab.',
    how: 'Use the coloured status button at the top to go live, hold, close or move back to test or draft, and Redirects for the client return links with a worked example. Pick a tab below for each part of the setup; every tab has its own "i" with more detail.',
    where: 'Changes apply to this project only. While a market is live, most changes reach new respondents straight away.',
  },
  'page:/projects/board': {
    title: 'Project board',
    what: 'Every project as a card by stage, and on a timeline by field dates.',
    how: 'Scan for projects that are stuck or late, and open a card to work on it.',
    where: 'All projects you can see.',
  },
  'page:/projects/templates': {
    title: 'Project templates',
    what: 'Saved project setups you reuse: markets, LOI/IR/CPI, quotas, vendors, client and survey links.',
    how: 'Save one from a project with Save as template, then pick it under Start from on Create project. Edit the name and description here or delete old ones.',
    where: 'Templates are shared with everyone in your organisation.',
  },
  'page:/won-bids': {
    title: 'Won bids',
    what: 'Bids marked as won in SampBidx arrive here automatically, so nothing is set up twice.',
    how: 'Open a bid and choose Create project; the client, markets, LOI, IR, CPI and completes are filled in for you.',
    where: 'Only bids sent from your SampBidx account. New bids are still made in SampBidx.',
  },
  'page:/clients': {
    title: 'Clients',
    what: 'The companies you run research for, with their contacts, billing details and redirect settings.',
    how: 'Add a client with its logo, edit details, switch it Active or Inactive, or bulk add from Excel or CSV.',
    where: 'Only active clients can be picked for new projects. All appear on reports and invoices.',
  },
  'page:/vendors': {
    title: 'Vendors',
    what: 'The panel companies that send you respondents, with a score from the last 180 days of traffic, their redirects and markets.',
    how: 'Add a vendor with its logo, switch it Active or Inactive, bulk add from Excel or CSV, or open one for its scorecard.',
    where: 'Only active vendors can be added to projects (Vendors & links tab).',
  },
  'page:/vendors/[id]': {
    title: 'Vendor',
    what: 'One vendor: scorecard, markets and capacity, saved redirect URLs, compliance documents and recent links.',
    how: 'Keep its redirects and capacity up to date here, so new projects fill them in by themselves.',
    where: 'Saved redirects are used on every project this vendor joins, unless a project overrides them.',
  },
  'page:/vendors/applications': {
    title: 'Vendor applications',
    what: 'Panel companies that signed up through your vendor sign-up link.',
    how: 'Check each one, then approve to create the vendor, the markets it covers and its portal login, or reject it.',
    where: 'Share the sign-up link only with companies you want to hear from.',
  },
  'page:/monitor': {
    title: 'Fieldwork monitor',
    what: 'Watches every live market: pace against field dates, stalls, incidence, drop-outs and quality, and raises alerts.',
    how: 'Sort by risk, open alerts, and apply reallocation suggestions to move completes between vendors in one click.',
    where: 'Live markets in all projects. Autopilot actions are set per project on its Monitor tab.',
  },
  'page:/reports': {
    title: 'Reports',
    what: 'Fieldwork performance by client, vendor, market and project: clicks, completes, conversion, IR, LOI, revenue and payout.',
    how: 'Pick a report and date range, filter, then save the view, download CSV or PDF, or schedule it by email.',
    where: 'Test traffic is never counted. Money can be shown in your reporting currency or each market\'s currency.',
  },
  'page:/reports/schedules': {
    title: 'Scheduled reports',
    what: 'Reports emailed automatically on a daily, weekly or monthly schedule.',
    how: 'Choose the report, filters, people to send to and the time. Add a PDF if you want one attached.',
    where: 'Sent through your organisation\'s email settings (Settings → Integrations).',
  },
  'page:/invoices': {
    title: 'Client invoices',
    what: 'Invoices you send clients, built from reconciled completes.',
    how: 'Create invoices from the Reconcile & invoice tab of a project, then mark them sent or paid, and download the PDF.',
    where: 'Client portal users see their own invoices.',
  },
  'page:/invoices/[id]': {
    title: 'Invoice',
    what: 'One client invoice: lines, tax, totals, status and payment.',
    how: 'Check the lines, mark it sent or paid with a payment reference, and download the PDF.',
    where: 'Invoice details (your legal name, address, tax ID) come from Settings → Invoice details.',
  },
  'page:/payables': {
    title: 'Vendor payables',
    what: 'What you owe each vendor for accepted completes, and the bills they send you.',
    how: 'Create a bill per vendor and period, add their invoice number, and mark it paid.',
    where: 'Rejected completes are left out. Vendors see their statements in the vendor portal.',
  },
  'page:/payables/[id]': {
    title: 'Vendor bill',
    what: 'One vendor bill: completes, payout, tax and status.',
    how: 'Check the lines against the vendor\'s invoice, then mark it approved or paid.',
    where: 'Paid bills can be exported to your accounting software from Accounting.',
  },
  'page:/accounting': {
    title: 'Accounting',
    what: 'Sends invoices, bills and payments to your accounting software, or downloads them as a file.',
    how: 'Pick what to export and the period, then download (Zoho Books, Tally, QuickBooks, Xero, journal CSV) or use Sync now for a connected system.',
    where: 'Each item remembers when it was exported, so you do not send it twice.',
  },
  'page:/requests': {
    title: 'Requests',
    what: 'Messages and tickets with clients and vendors, including vendor disputes about rejected completes.',
    how: 'Open a request to reply, add an internal note only staff can see, or close it. Use Write to start a new one.',
    where: 'Replies are emailed to the client or vendor and shown in their portal.',
  },
  'page:/requests/[id]': {
    title: 'Request',
    what: 'One conversation with a client or vendor.',
    how: 'Reply to send an email, use Internal note for staff-only comments, and change the status when done.',
    where: 'Linked to a project when one was chosen.',
  },
  'page:/redirect-health': {
    title: 'Redirect health',
    what: 'Shows whether respondents reach the right page at the end of a survey, and why some fall back.',
    how: 'Look for spikes in fallbacks or failed vendor callbacks, then open the project to fix its redirects.',
    where: 'All projects, or one project when opened from it.',
  },
  'page:/portal-access': {
    title: 'Portal access',
    what: 'Logins for your clients and vendors to their own portal.',
    how: 'Add a portal user for a client or vendor with a temporary password; they change it on first sign-in.',
    where: 'Clients see their projects, files and invoices. Vendors see their links, respondents, quotes and statements.',
  },
  'page:/chat': {
    title: 'Team chat',
    what: 'Chat for staff only: Announcements, General, a room per project, private groups and direct messages. It runs on your SampTrek server.',
    how: 'Pick a conversation, or press New. In a project room, tick "Post as a project update" to share how the project is doing.',
    where: 'Messages are saved on this device too, so you can read them offline. What you write offline is sent when you reconnect.',
  },
  'page:/tasks': {
    title: 'Tasks',
    what: 'Your to-dos and reminders, including ones the AI copilot made for you.',
    how: 'Add a task with an optional reminder date; reminders show in the bell.',
    where: 'Tasks are personal unless assigned to someone else.',
  },
  'page:/copilot': {
    title: 'AI copilot',
    what: 'Ask questions about your projects, vendors and reports in plain words, by text or voice.',
    how: 'Type or speak a question. When it suggests an action, nothing happens until you confirm the card.',
    where: 'Uses only data you can see. Admins set limits in Settings → AI copilot.',
  },
  'page:/data-processing': {
    title: 'Data processing & quality',
    what: 'Checks respondent data quality across projects: speeders, duplicates, straight-liners and other flags.',
    how: 'Filter by project or market and review flagged respondents before reconciling.',
    where: 'Completes from live traffic only.',
  },
  'page:/analytics': {
    title: 'Reporting & analytics',
    what: 'Trends across projects, clients and vendors over time.',
    how: 'Pick a period and grouping to compare performance.',
    where: 'Test traffic is never counted.',
  },
  'page:/account/security': {
    title: 'Your account',
    what: 'Your password and two-step sign-in.',
    how: 'Change your password, or turn on an authenticator app and keep the recovery codes somewhere safe.',
    where: 'Only your own login.',
  },
  'page:/settings': {
    title: 'Settings',
    what: 'Organisation-wide settings: finance, invoice details, captcha, redirect security, alerts, sign-in and more.',
    how: 'Open a section, change it and save. Most changes apply straight away.',
    where: 'Every project and user in your organisation. Admins only for most sections.',
  },
  'page:/settings/team': {
    title: 'Team',
    what: 'Your staff logins and their roles.',
    how: 'Invite by email, change role, deactivate someone who left, or sign them out everywhere.',
    where: 'Staff only. Client and vendor logins are under Portal access.',
  },
  'page:/settings/features': {
    title: 'Features & access',
    what: 'Who in your team gets each feature your plan includes.',
    how: 'Pick Everyone, Admins only, Chosen people (then tick them) or No one. Locked features are not in your plan: ask your SampTrek provider or upgrade under Subscription.',
    where: 'Applies at once on the web and in the Android/iOS app, and the server refuses what someone was not given. New features such as Team chat start with admins only.',
  },
  'page:/settings/integrations': {
    title: 'Integrations',
    what: 'Every connection to another service, set up here and not on the server: email, sign-in, accounting, AI, push and more.',
    how: 'Open a card, fill in the keys from the other service, Test, then Save.',
    where: 'Your whole organisation. The Super Admin can allow or block each integration.',
  },
  'page:/settings/branding': {
    title: 'Branding',
    what: 'Your own name, logo, colours and web address for your team, clients and vendors.',
    how: 'Upload logos, pick colours, see the preview, then save. For a custom domain, add the DNS records shown and verify.',
    where: 'Staff app and portals. Respondent pages stay neutral.',
  },
  'page:/settings/appearance': {
    title: 'Appearance',
    what: 'How the app looks for you: theme, colours, density and motion.',
    how: 'Pick a theme or adjust colours and see the live preview.',
    where: 'Only your own view, unless an admin sets the default theme in Branding.',
  },
  'page:/settings/privacy': {
    title: 'Privacy',
    what: 'How long respondent data is kept, the consent notice shown before a survey, and erasure requests.',
    how: 'Set retention days, write consent notices per market, and erase a respondent by panel UID when asked.',
    where: 'Every project. Consent notices show first on the gate page.',
  },
  'page:/settings/developers': {
    title: 'API and webhooks',
    what: 'Lets other systems read SampTrek data with an API key, and get events pushed to your own URL.',
    how: 'Create a key with only the scopes it needs, copy it once, and add webhook URLs for the events you want.',
    where: 'Admins only. Keys belong to the organisation, not a person.',
  },
  'page:/settings/forms': {
    title: 'Form gallery',
    what: 'A playground of the form controls used across SampTrek.',
    how: 'Try the controls and keyboard. Nothing here is saved.',
    where: 'For reference only.',
  },
  'page:/settings/subscription': {
    title: 'Subscription',
    what: 'Your organisation\'s SampTrek plan, payments and invoices.',
    how: 'Choose or renew a plan and pay online, or pay offline and upload the proof.',
    where: 'Admins only. Limits and features follow the plan.',
  },
  'page:/super-admin': {
    title: 'Super Admin',
    what: 'Every organisation on this server: subscriptions, usage and what needs your attention.',
    how: 'Open an organisation to change its plan, features or status.',
    where: 'Only the person who runs the server sees this.',
  },
  'page:/super-admin/organizations': { title: 'Organisations', what: 'Each customer company on this server, its plan and usage.', how: 'Add one, or open one to manage it.', where: 'Super Admin only.' },
  'page:/super-admin/organizations/[id]': { title: 'Organisation', what: 'One organisation: subscription, features, integrations, people and activity.', how: 'Switch features on or off for the organisation or one person, separately for web and mobile.', where: 'Changes reach their apps within seconds.' },
  'page:/super-admin/plans': { title: 'Plans', what: 'Feature packages with user and project limits and prices.', how: 'Create or edit a plan, tick the features it includes, and set monthly or yearly prices.', where: 'Organisations without a plan keep every feature.' },
  'page:/super-admin/registrations': { title: 'Registrations', what: 'Companies that signed up on the registration page.', how: 'Approve to start them on a plan, or reject.', where: 'Only when the registration page is open.' },
  'page:/super-admin/billing': { title: 'Billing', what: 'Payments organisations make for their plans.', how: 'Confirm offline payments and check online ones.', where: 'Super Admin only.' },
  'page:/super-admin/activity': { title: 'Activity', what: 'Everything admins and users did, in every organisation.', how: 'Filter by organisation, person or action.', where: 'Super Admin only.' },
  'page:/super-admin/automation': { title: 'Automation', what: 'Rules that run by themselves: When something happens, Only if a condition holds, Then do something.', how: 'Add a ready-made recipe or write your own rule, and check the run log.', where: 'Time rules are checked every hour.' },
  'page:/super-admin/integrations': { title: 'Integrations overview', what: 'Which organisation may use, and has set up, each integration.', how: 'Open an organisation to allow or block one.', where: 'Super Admin only.' },
  'page:/portal/client': { title: 'Client portal', what: 'Your projects with us and how fieldwork is going in each market.', how: 'Open a project for progress by market.', where: 'Only projects for your company.' },
  'page:/portal/client/projects/[id]': { title: 'Project progress', what: 'Completes against target in each market.', how: 'Check progress; use Requests to ask us anything.', where: 'This project only.' },
  'page:/portal/vendor': { title: 'Vendor portal', what: 'Your projects, entry links, respondents and payouts.', how: 'Copy your entry links, check statuses and download unique links.', where: 'Only projects you were added to.' },
  'page:/portal/quotes': { title: 'Quotes', what: 'Requests for your CPI and how many completes you can deliver.', how: 'Fill in CPI, completes and days needed, and send. You can change it until it is accepted.', where: 'An accepted quote adds you to the project in that market.' },
  'page:/portal/invoices': { title: 'Invoices', what: 'Invoices we have sent you, with the PDF.', how: 'Open or download any invoice.', where: 'Your company only.' },
  'page:/portal/files': { title: 'Files', what: 'Files we share with you, and compliance documents we need from you.', how: 'Download shared files and upload compliance documents before they expire.', where: 'Your company only.' },
  'page:/portal/requests': { title: 'Requests', what: 'Your messages with us, including disputes about rejected completes.', how: 'Start a new request or reply to one.', where: 'We get an email for each message.' },
  'page:/portal/requests/[id]': { title: 'Request', what: 'One conversation with us.', how: 'Reply below; we are notified by email.', where: 'This request only.' },
  'page:/portal/account': { title: 'Your account', what: 'Your portal login.', how: 'Change your password here.', where: 'Only your own login.' },

  // ─────────────────────────── Project tabs ───────────────────────────
  'tab:Overview': {
    what: 'The markets of this project (country + language + target group) with LOI, IR, CPI, completes and the client\'s test and live survey links.',
    how: 'Edit a market inline, add a market, or bulk edit several. Set each market live, on hold or closed on its own.',
    where: 'Each row is one market. A market only opens when it has a live link and at least one vendor.',
  },
  'tab:Vendors & links': {
    what: 'Which vendors send respondents to each market, what you pay them (payout CPI), their targets, and the entry links you give them.',
    how: 'Add a vendor to a market, set payout and target completes, then copy the entry link and send it to the vendor. Pause a vendor to stop their traffic.',
    where: 'Per vendor per market. Payout above the client CPI is blocked unless allowed.',
  },
  'tab:Vendor unique links': {
    what: 'Single-use entry links you make for vendors who need one link per respondent instead of one shared link.',
    how: 'Pick vendor and market, choose how many links, generate, then download the CSV for the vendor. Revoke or expire links you no longer want.',
    where: 'Each link works once. A second open shows the Duplicate page. Opens while a market is paused do not use up a link.',
  },
  'tab:Client unique links': {
    what: 'Survey links your client made, one per respondent, uploaded per market. Each respondent is sent to the next unused one.',
    how: 'Upload the client\'s Excel, CSV or pasted links, check them, add them, then turn on Use client unique links for the market.',
    where: 'Per market, for every vendor. No link is given twice. A market cannot go live with none left.',
  },
  'tab:Quotas & monitor': {
    what: 'Quota cells and live fieldwork health in one place: cell targets, field dates, autopilot (including auto-pause), alerts and each market\'s pace.',
    how: 'Set up cells at the top, then field dates and autopilot below. Check alerts and the live markets table while fieldwork runs.',
    where: 'This project. Old links to the Quotas or Monitor tab open this tab. The organisation-wide view is Fieldwork monitor.',
  },
  'tab:SampAudience': {
    what: 'Sends this project to the SampAudience panel to find respondents.',
    how: 'Describe who should take part, set the reward and quota cells, and request an audience.',
    where: 'Markets where SampAudience is offered.',
  },
  'tab:Gate & security': {
    what: 'Checks respondents pass before they reach the client\'s survey: duplicate and fraud checks, a human check (captcha), gate and prescreener questions.',
    how: 'Turn on the checks you need, add questions, then Try it with a test link to walk through as a respondent.',
    where: 'Every respondent of every market and vendor of this project. Failed checks go to the Security page and do not count.',
  },
  'tab:Respondent pages': {
    what: 'The pages respondents see at the end or when stopped: Complete, Terminate, Over quota, Security, Duplicate, Closed and more.',
    how: 'Pick a template, set colours and images, and change the words for each status. The preview shows each page.',
    where: 'Used when no vendor redirect applies, or before it, for every market of this project.',
  },
  'tab:Redirects': {
    what: 'Where each respondent goes after the survey, for each status (Complete, Terminate, Over quota, Security…), usually back to the vendor.',
    how: 'Set the project status matrix, add overrides for a country or vendor, map dynamic parameters, and check routing in the diagram.',
    where: 'Priority: vendor + country, then vendor, then country, then the project matrix.',
  },
  'tab:QA studio': {
    what: 'Tests the whole respondent journey before going live, without counting toward real traffic.',
    how: 'Pick a market and vendor, start a test, choose an outcome, and see exactly where the respondent would be sent.',
    where: 'Test traffic is never counted in reports or invoices.',
  },
  'tab:Respondents': {
    what: 'Every respondent session: who came from which vendor, their status, LOI and checks.',
    how: 'Filter by market, vendor or status, open a session for its timeline, and export to CSV.',
    where: 'This project only.',
  },
  'tab:Answers': {
    what: 'The answers respondents gave to the gate survey and prescreener questions.',
    how: 'Filter and download the answers as CSV.',
    where: 'Only questions asked by SampTrek, not the client\'s survey.',
  },
  'tab:Reconcile & invoice': {
    what: 'Matches completes with the client\'s final list, then turns accepted completes into a client invoice.',
    how: 'Paste or upload the client\'s list of respondent IDs, review what changes, apply, then create the invoice.',
    where: 'Rejected completes are taken out of revenue and vendor payout.',
  },
  'tab:Files & requests': {
    what: 'Files shared with the client or vendors for this project (questionnaire, deliverables) and requests about it.',
    how: 'Upload a file and choose who can see it, or start a request.',
    where: 'Shown in the client or vendor portal for the people you share with.',
  },
  'tab:Team': {
    what: 'Your team\'s comments on this project, the handover checklist and everything that happened on the project.',
    how: 'Comment and type @ to mention a colleague. Start a handover when another project manager takes over.',
    where: 'Staff only. Clients and vendors never see this tab or its comments.',
  },
  'tab:History': {
    what: 'Every change to this project\'s settings, who made it and when.',
    how: 'Open a change to see before and after, and Restore to go back.',
    where: 'This project\'s settings only, not respondent data.',
  },

  // ───────────────────── Project: sections and explicit ids ─────────────────────
  'section:/projects/[id]::Comments': {
    what: 'A conversation about this project for your team, oldest first.',
    how: 'Type @ and pick a colleague to mention them; they get a bell notification and an email (Zoho Mail). Edit or delete your own comments.',
    where: 'Staff of your organisation only; never shown in the client or vendor portal.',
  },
  'section:/projects/[id]::Handover': {
    what: 'A checklist for handing this project to another project manager, so nothing is missed.',
    how: 'Start a handover, choose who takes over and which items to cover. You both tick items; they accept once every item is ticked.',
    where: 'This project. On accept, the receiver becomes the project manager unless you untick that option.',
  },
  'section:/projects/[id]::Activity': {
    what: 'Everything that happened on this project, newest first: changes, comments, handovers, fieldwork events and requests.',
    how: 'Use the chips to show one kind only, and Show older to go back further.',
    where: 'This project. The full settings before and after are on the History tab.',
  },
  'field:/projects/[id]::Hand over to': { what: 'The admin or project manager who takes over this project.', how: 'Pick one person; viewers and sales cannot run a project.', where: 'This handover. They get a bell notification and an email.' },
  'field:/projects/[id]::Handover note': { what: 'What the next person should know first, such as client habits or risks.', how: 'Write a few lines; it shows at the top of the checklist.', where: 'This handover, and the email to the receiver.' },
  'section:Usage and limits': {
    what: 'What your plan allows (projects, clients, vendors, logins, clicks, completes…) and how much you use now.',
    how: 'Bars turn amber at 80% and red when a limit is reached. Monthly counts reset on the 1st.',
    where: 'Your whole organisation. Your SampTrek provider sets the limits.',
  },
  'section:Limits in this plan': {
    what: 'Usage limits every organisation on this plan gets.',
    how: 'Type a number, or leave a field empty for no limit. Choose whether running out of clicks or completes stops new entries or only shows the overrun.',
    where: 'Every organisation on the plan, at once. One organisation can get its own numbers on its Subscription tab.',
  },
  'section:Runs as': {
    what: 'The name, domain and respondent ID prefix this organisation uses on links and redirects.',
    how: 'Traffic on their own domain and name is still counted here. Use Observe to open their workspace read-only.',
    where: 'This organisation only.',
  },
  'section:Clicks and completes per day': { what: 'Live respondent entries per day, with completes shown darker.', how: 'Pick 7, 30 or 90 days. Hover a bar for the numbers.', where: 'This organisation; test links are left out.' },
  'section:Busiest projects': { what: 'The projects with the most live clicks in the period.', how: 'Open Observe to see a project in full.', where: 'This organisation only.' },
  'section:Usage': {
    what: 'How much of each limit this organisation uses.',
    how: 'Change its limits on the left, or move it to another plan.',
    where: 'This organisation only.',
  },
  'section:Project settings': {
    what: 'Project-wide settings such as name, client, category, managers, link variable and dates.',
    how: 'Change a value and save; it applies to every market.',
    where: 'This project.',
  },
  'project.redirectsPopup': {
    title: 'Redirects',
    what: 'The prebuilt links the client\'s survey sends respondents back to, one per status, and a worked example that follows one respondent from the vendor, through the client\'s survey, back to SampTrek and on to the vendor.',
    how: 'Copy all and send them to the client. Click a status to see its links filled in with an example token and respondent ID, and copy the snippet for the client\'s survey tool.',
    where: 'Every market of this project. Where vendors are sent after SampTrek is set on the Redirects tab.',
  },
  'project.statusMenu': {
    title: 'Project status',
    what: 'Where the project is: Draft (grey), Test (blue), Live (green), Hold (orange), Closed (red) or Invoiced (purple).',
    how: 'Click the coloured button and pick a status. Closed, Draft and Invoiced ask for a second click. Going live opens every ready market and tells you which are not ready.',
    where: 'This project and all its entry links: Hold and Closed show the paused or closed page to new respondents.',
  },
  'project.vendorCard': {
    title: 'Vendor in this project',
    what: 'One vendor\'s setup on this project: markets, payout CPI, target completes, link variable and entry links.',
    how: 'Change payout or target, copy the entry link, or pause the vendor in a market.',
    where: 'This vendor on this project only.',
  },
  'section:Vendors per market': { what: 'All vendors on this project, grouped by market or by vendor.', how: 'Switch the grouping at the top right. Add vendors to a market, then set payout, target and link variable.', where: 'This project.' },
  'project.vendorMarket': {
    title: 'Vendors in this market',
    what: 'The vendors sending respondents to this market, with payout CPI, target completes and their entry links.',
    how: 'Add a vendor, set payout and target, copy the entry link for the vendor, or pause a vendor here.',
    where: 'This market only. Each vendor gets its own entry link per market.',
  },
  'project.uniqueLinks.list': { title: 'Links', what: 'Every vendor unique link with its status: Unused, Used, Expired or Revoked.', how: 'Filter by batch or status, find a key, revoke links, or download the CSV.', where: 'This project.' },
  'project.respondentPreview': { title: 'Live preview', what: 'How each respondent page will look.', how: 'Switch status and device to check each page before saving.', where: 'This project.' },
  'project.invoices': { title: 'Invoices', what: 'Client invoices made from this project.', how: 'Create an invoice after reconciling, then send it.', where: 'This project; all invoices are under Invoices.' },
  'section:Step 3 · Redirect mode': {
    title: 'Redirect mode',
    what: 'How respondents are sent back at the end: to each vendor\'s saved redirect (prebuilt), to fixed URLs, or a mix (hybrid).',
    how: 'Pick a mode. Reset to prebuilt sends every status to each vendor\'s saved redirect again.',
    where: 'Every market and vendor of this project.',
  },
  'section:Effective routing': { what: 'Which rule wins for every country, vendor and status, and where it comes from.', how: 'Check this before going live; fix anything that falls back.', where: 'This project.' },
  'create.markets': {
    title: 'Target markets',
    what: 'Each market of the project: country + language + target group, with LOI, IR, client CPI and completes.',
    how: 'Add rows, use Apply to all to copy a value to every market, or Paste from Excel.',
    where: 'Each row becomes one market of the project.',
  },
  'project.clientLinks.markets': { title: 'Markets', what: 'For each market: whether client unique links are on, and how many are unused or given out.', how: 'Turn a market on once its links are uploaded. Upload more when it says low.', where: 'This project.' },
  'project.clientLinks.upload': { title: 'Upload client links', what: 'Adds the client\'s per-respondent survey links to one market.', how: 'Choose the market, pick the file or paste the links, press Check links, then Add.', where: 'Only the chosen market. Repeats and lines that are not links are skipped.' },
  'project.clientLinks.list': { title: 'Client links', what: 'Every uploaded client link: unused or given out, to which respondent and with what outcome.', how: 'Filter by market or status, search part of a link, or download the CSV.', where: 'This project.' },
  'project.dashboardLinks': { title: 'Client dashboard links', what: 'Read-only links your client opens to watch completes, markets and quotas live, without a SampTrek login.', how: 'Make a link, copy it and send it to the client. Turn it off when fieldwork ends or the link was shared too widely.', where: 'This project only. Drafts are never shown; test traffic is never counted.' },
  'project.dashboardLinks.new': { title: 'New link', what: 'Makes a new dashboard link with its own settings.', how: 'Say who it is for, pick an end date if you want one, choose what extra it shows, then press Make link.', where: 'Each link has its own settings, so one client team can see spend and another not.' },
  'project.dashboardLinks.label': { title: 'Who it is for', what: 'A name for the link, e.g. the client team it was sent to. Only staff see it.', how: 'Type a short name. Leave it empty if there is only one link.', where: 'Shown in this list, not on the client\'s page.' },
  'project.dashboardLinks.expires': { title: 'Works until', what: 'The last day the link works. After it, the page says the link has ended.', how: 'Pick a date, or leave it empty to keep the link working until you turn it off.', where: 'This link only. The link works through the whole of that day.' },
  'project.dashboardLinks.money': { title: 'Show CPI and spend', what: 'Adds the client CPI per market and the spend so far (CPI × completes) to the page.', how: 'Switch it on when the client should follow the budget. Vendor cost and margin are never shown.', where: 'This link only. You can change it later; the client sees it on the next refresh.' },
  'project.dashboardLinks.vendors': { title: 'Show vendor names', what: 'Adds each vendor\'s name with its completes and target to the page.', how: 'Switch it on only when the client may know your sample sources. Vendor CPI is never shown.', where: 'This link only. You can change it later; the client sees it on the next refresh.' },
  'project.dashboardLinks.list': { title: 'Working links', what: 'Every link that works now, with how often and when it was last opened.', how: 'Copy or open a link, change what it shows, or press Turn off to stop it at once.', where: 'Turned-off and ended links are kept below for the record and cannot be switched back on.' },
  'settings.numbering': { title: 'Work orders and UID prefix', what: 'How work order numbers are made, and the prefix on respondent IDs sent to client surveys.', how: 'Set the prefix and the next number; check the last one given. Add a UID prefix for your brand.', where: 'Every new project and new respondents. Admins can change it.' },
  'page:/settings/options': { title: 'Dropdown options', what: 'Every option your team added with “Add +”: categories, target groups, languages and link variables.', how: 'Add an option, fix a typo, or remove one you no longer use.', where: 'The dropdowns across SampTrek. Projects keep the values they already use.' },
  'project.uniqueLinks.generate': {
    title: 'Generate vendor unique links',
    what: 'Makes a batch of single-use links for one vendor in one market.',
    how: 'Choose vendor and market, how many links (up to 50,000), an optional name and expiry, then Generate and download.',
    where: 'Only the chosen vendor and market.',
  },
  'section:Batches': { what: 'Each set of unique links you generated.', how: 'Download a batch again, or revoke the links you do not want used.', where: 'This project.' },
  'section:By vendor and market': { what: 'How many unique links are unused, used, expired or revoked for each vendor and market.', how: 'Check when a vendor is running out and generate more.', where: 'This project.' },
  'project.quotaMarket': {
    title: 'Quota cells for this market',
    what: 'The cells that limit completes in this market.',
    how: 'Add a cell, choose the device or answers it matches, and set its limit. Use Quick add for one cell per answer.',
    where: 'Only this market. The market target and vendor targets still apply.',
  },
  'section:Field dates': { what: 'When fieldwork starts and must end.', how: 'Set the end date so the monitor can work out the daily pace each market needs.', where: 'Every market of this project.' },
  'section:/projects/[id]::Live markets': { what: 'Each live market\'s progress, pace and risk.', how: 'Look for markets behind pace and act on them.', where: 'Live markets of this project.' },
  'section:/monitor::Live markets': { what: 'Every live market across projects, with pace and risk.', how: 'Sort by risk and open a project to act.', where: 'All live projects.' },
  'project.autopilot': {
    title: 'Autopilot',
    what: 'Actions the monitor may take on its own, such as pausing a vendor with bad quality or closing a full market.',
    how: 'Tick only the actions you are comfortable with. Each one is logged and raised as an alert.',
    where: 'Live markets of this project.',
  },
  'project.autoPause': {
    title: 'Auto-pause at a checkpoint',
    what: 'A soft-launch stop: the autopilot pauses each market (or vendor link) once it reaches a share of its target or a number of completes, so you can check the data.',
    how: 'Choose market or vendor link, then a % of target or a number of completes. Resume when the data looks right; it will not pause that one again.',
    where: 'Live markets of this project. Once every market or link was paused or reached its target, the autopilot switches the checkpoint off.',
  },
  'project.speederCheck': {
    title: 'Speeder check',
    what: 'Catches respondents who rush the survey: a complete faster than the chosen share of the planned LOI (1/4, 1/3, 2/4, 3/4…) becomes a quality fail with the reason Speeder.',
    how: 'Turn it on and pick the share before launch. The list shows the minimum minutes per market. Speeders are not counted, billed or paid.',
    where: 'Every market of this project, timed from when the respondent reaches the client survey. Shows as Speeders in the fieldwork status and reports.',
  },
  'project.fieldStatus': {
    title: 'Fieldwork status',
    what: 'Live counts for this project: completes, in survey, terminates, quota full, speeders and other quality fails, plus Avg LOI and Avg IR.',
    how: 'Avg LOI is the mean minutes of live completes; Avg IR is completes ÷ (completes + terminates). Planned values from the bid are shown beside them.',
    where: 'Live traffic only (test links are left out). A live project refreshes every 30 seconds.',
  },
  'project.liveMoney': {
    title: 'Revenue, cost and profit',
    what: 'Money earned and owed so far: revenue is client CPI × completes, cost is the vendor payout for those completes, profit is the difference.',
    how: 'Watch profit while fieldwork runs. Expected revenue shows the value at target. Rejected completes drop out after reconciliation.',
    where: 'This project, per CPI currency. Live projects refresh every 30 seconds.',
  },
  'project.forecast': {
    title: 'Forecast at finish',
    what: 'When this project will reach its targets and the revenue, cost, profit and margin it will end with, if fieldwork keeps its current pace and vendor mix.',
    how: 'Finish date comes from the completes of the last 72 hours. Remaining completes are priced at the vendors delivering now. Check By market to see which market is slow or costly.',
    where: 'Live and held markets of this live project, per CPI currency; closed markets count with what they earned. SampTrek alerts when the margin drops under the floor.',
  },
  'field:Margin alert below': {
    title: 'Margin alert below',
    what: 'This project\'s own margin floor: SampTrek raises a margin alert when the forecast margin at finish is under it.',
    how: 'Enter a whole percent, for example 25. Leave empty to use the margin floor from Settings → Fieldwork alerts.',
    where: 'This project only. The alert waits for 5 completes in a currency.',
  },
  'field:Margin floor': {
    what: 'The lowest forecast margin a live project may head for before SampTrek raises a margin alert.',
    how: 'Enter a whole percent. Projects can set their own in Quotas & monitor → Autopilot.',
    where: 'Every live project of your organisation that has no floor of its own.',
  },
  'field:Margin drop': {
    what: 'Raise the margin alert when the forecast margin falls this many points under the margin planned from the bid, even above the floor.',
    how: 'Enter whole points, for example 10: a 45% plan heading for 34% alerts.',
    where: 'Every live project of your organisation.',
  },
  'field:Avg LOI': { title: 'Avg LOI', what: 'Average minutes live completes actually took, from reaching the client survey to completing.', how: 'Compare it with the planned LOI; much shorter suggests speeders, much longer means drop-outs.', where: 'Project list and fieldwork status. Reports call it LOI.' },
  'field:Avg IR': { title: 'Avg IR', what: 'Actual incidence: completes ÷ (completes + terminates).', how: 'Compare it with the planned IR; a big drop raises the real cost per complete.', where: 'Project list and fieldwork status. Reports call it IR.' },
  'field:Speeders': { what: 'Completes rejected by the speeder check because they were too fast.', how: 'Set the check in Gate & security. A high count points at a vendor or a survey that is easy to rush.', where: 'Fieldwork status, project list and reports.' },
  'project.alerts': { title: 'Active alerts', what: 'Problems the monitor found: low pace, stalls, low incidence, high drop-out, poor quality or a margin heading too low.', how: 'Open an alert, fix the cause, then dismiss it.', where: 'This project.' },
  'project.security': {
    title: 'Respondent security',
    what: 'Checks that stop duplicates, bots and fraud before respondents reach the survey.',
    how: 'Turn on the checks you need. Respondents who fail are sent to the Security page and are not counted.',
    where: 'Every market and vendor of this project.',
  },
  'section:Human check style': { what: 'Which free captcha respondents solve to prove they are human.', how: 'Pick a style; only free options are offered.', where: 'Shown on the gate page of this project.' },
  'section:Gate survey questions': {
    what: 'Short questions SampTrek asks before the client survey, for example age, gender or region.',
    how: 'Start from an audience set (B2B, B2C, parents, teens, healthcare consumers, patients, caregivers) or single questions from the library, then edit, remove or add questions and set which answers qualify. Those who do not qualify get the Terminate page.',
    where: 'Every respondent of this project. Answers can drive quota cells.',
  },
  'section:Prescreener questions': {
    what: 'Extra screening questions to check respondents fit the target group.',
    how: 'Add questions and mark the qualifying answers.',
    where: 'Asked after the gate survey, for every market of this project.',
  },
  'section:Signed entry links': {
    what: 'Makes vendors sign each entry link with a secret, so nobody can fake or change a link.',
    how: 'Turn it on and give the vendor the signing instructions. Unsigned links are refused.',
    where: 'Vendors on this project.',
  },
  'section:Try it': { what: 'Walk through the gate as a respondent would.', how: 'Save first, then open a test link.', where: 'Test traffic is not counted.' },
  'section:What the checks caught': { what: 'How many respondents each check stopped.', how: 'Use it to see if a vendor sends poor traffic.', where: 'This project.' },
  'project.respondentTemplate': { title: 'Template', what: 'The overall look of respondent pages.', how: 'Pick a template; colours and words can still be changed.', where: 'All respondent pages of this project.' },
  'project.respondentType': { title: 'Type and shape', what: 'Fonts and corner roundness of respondent pages.', how: 'Pick a font and shape.', where: 'All respondent pages of this project.' },
  'section:Brand and images': { what: 'Brand name, logo and images on respondent pages.', how: 'Keep the Sampledge logo on, add your own brand name and images, or turn both off for a neutral page.', where: 'All respondent pages of this project.' },
  'shell.notifications': {
    title: 'Notifications',
    what: 'Alerts that need someone to act: failed callbacks, markets close to target or with no traffic, expiring vendor documents, scheduled changes that failed and your own task reminders.',
    how: 'The red number counts only alerts you have not seen yet. Opening this menu marks them read for you. They stay listed until fixed, and count as new again if they change (3 failed callbacks become 5).',
    where: 'Read marks are per person: a colleague still sees the alert as new until they open their own menu. The phone app shares the same read marks.',
  },
  'question.sets': {
    title: 'Audience question sets',
    what: 'Ready-made demographic questions for B2B decision makers, B2C consumers, parents, teens (13 to 17, with a parent or guardian check), healthcare consumers, patients and caregivers. Each set already marks which answers qualify and which screen out.',
    how: 'Add to project adds the whole set (questions already there are skipped). Then edit, delete or add questions. To change a set for everyone, use Save this project’s questions as this set; Reset to standard undoes it.',
    where: 'The gate survey of this project (and of Create project). Saved sets are shared by everyone in your organisation; changing a set never changes projects that already use its questions.',
  },
  'respondent.platformLogo': {
    title: 'Show the Sampledge logo',
    what: 'Puts the Sampledge logo on the gate page and every end page (complete, terminate, quota full and the rest), and its icon on the browser tab. If your organisation set its own name or logo in Settings → Branding, that is shown instead.',
    how: 'On by default. With no project logo or brand name, the logo sits at the top. When you add a project logo or brand name, yours goes at the top and the Sampledge logo moves to a small “Powered by” line at the bottom. Turn it off for a fully neutral page.',
    where: 'Every respondent page of this project, including the countdown page before a vendor redirect.',
  },
  'section:/projects/[id]::Colours': { what: 'Colours of the respondent pages.', how: 'Pick colours and check the preview.', where: 'All respondent pages of this project.' },
  'section:/settings/appearance::Colours': { what: 'Accent and surface colours of the app for you.', how: 'Pick colours and check the live preview.', where: 'Only your own view.' },
  'section:Words on each page': { what: 'Heading, message and button for each status page.', how: 'Pick a status and write what respondents should read.', where: 'This project.' },
  'section:Extras': { what: 'Extra options such as a countdown before redirecting.', how: 'Turn on what you need.', where: 'All respondent pages of this project.' },
  'section:Status matrix (project level)': {
    what: 'The default destination for each status on this project.',
    how: 'Each status starts from the vendor\'s saved redirect. Switch a status to a custom URL or an API rule when needed.',
    where: 'Every vendor and country without an override.',
  },
  'project.redirectOverrides': {
    title: 'Country and vendor overrides',
    what: 'Exceptions to the status matrix for one country, one vendor, or both.',
    how: 'Add an override, pick country and/or vendor and status, then set the URL.',
    where: 'Priority: vendor + country, then vendor, then country, then the matrix.',
  },
  'section:Dynamic parameter mapping': { what: 'Passes values like the respondent ID into redirect URLs.', how: 'Map each placeholder (for example {uid}) to where its value comes from.', where: 'All redirects of this project.' },
  'section:How redirects work in SampTrek': { what: 'A short guide to the redirect flow.', how: 'Read it once before setting up redirects.', where: 'Every project.' },
  'project.vendorRedirects': { title: 'Vendor redirects', what: 'The redirect URLs saved on each vendor of this project.', how: 'Edit them on the vendor page so every project gets the change.', where: 'Every project using these vendors.' },
  'project.apiDestinations': { title: 'API destinations', what: 'Redirect rules that ask your server where to send a respondent.', how: 'Set the endpoint and fallback URL; requests are signed with your organisation\'s secret.', where: 'Statuses that use an API rule.' },
  'project.redirectVersions': { title: 'Version history', what: 'Saved versions of the redirect setup.', how: 'Schedule a version to go active later, compare versions, or roll back.', where: 'This project.' },
  'project.qaStudio': { title: 'Redirect QA studio', what: 'Tests the respondent journey for any market and vendor.', how: 'Choose market, vendor and outcome to see where the respondent goes.', where: 'Test traffic only.' },
  'project.reconcile': { title: 'Reconcile with the client\'s list', what: 'Accepts or rejects completes based on the client\'s final list of valid IDs.', how: 'Paste the IDs, review the changes, then apply.', where: 'This project. Changes revenue, payout and invoices.' },
  'section:Reconciliation history': { what: 'Every reconciliation done on this project.', how: 'Check what changed and when.', where: 'This project.' },
  'section:Files': { what: 'Files for this project.', how: 'Upload and choose who can see each file.', where: 'Shared files appear in portals.' },
  'section:Requests about this project': { what: 'Requests linked to this project.', how: 'Open one to reply.', where: 'This project.' },
  'section:Audience requests': { what: 'Audiences you asked SampAudience for.', how: 'Check the status of each request.', where: 'This project.' },
  'section:Request an audience': { what: 'Asks SampAudience to find respondents for this project.', how: 'Describe who should take part and the reward, then send.', where: 'This project.' },
  'section:Quota cells for SampAudience': { what: 'Quota cells shared with SampAudience.', how: 'Check they match your Quotas tab.', where: 'This project.' },
  'section:Clone project': { what: 'Copies this project into a new one.', how: 'Give the new project a name and choose what to copy.', where: 'Survey links are not copied.' },
  'section:Save as template': { what: 'Saves this project\'s setup as a template.', how: 'Name it and choose what to include.', where: 'Shared with your organisation.' },

  // ───────────────────────── Create project ─────────────────────────
  'section:Project information': { what: 'Who the project is for and who runs it.', how: 'Pick the client, name the project, and set category, type and the team.', where: 'Whole project.' },
  'section:Basics: LOI, IR, completes and CPI': {
    what: 'The markets and their numbers: length of interview, incidence, completes and client CPI.',
    how: 'Add a row per market (country + language + target group). Use Apply to all or paste rows from a spreadsheet.',
    where: 'Each row is one market. The same country can appear twice with a different language or target group.',
  },
  'section:Devices': { what: 'Which devices respondents may use.', how: 'Untick devices that are not allowed.', where: 'Every market of this project.' },
  'section:Security and respondent quality': { what: 'The checks respondents pass before the survey.', how: 'Turn checks on or off; change them later in Gate & security.', where: 'Every market.' },
  'section:/projects/new::Gate survey questions': { what: 'Questions asked before the survey, such as age or gender.', how: 'Pick an audience set (B2B, B2C, parents, teens, healthcare) or add questions one by one, now or later in Gate & security. Every question stays editable.', where: 'Every market.' },
  'section:Survey redirects': { what: 'Where respondents go after the survey for each status.', how: 'Keep the vendor defaults or set your own. Change later on the Redirects tab.', where: 'Every market and vendor.' },
  'create.vendors': { title: 'Vendors', what: 'Vendors to add to every market when the project is created.', how: 'Pick vendors and set payout CPI and target.', where: 'All markets; adjust later on Vendors & links.' },

  // ───────────────────────── Project fields ─────────────────────────
  'field:LOI': { title: 'LOI', what: 'Length of interview: how many minutes the survey takes. In reports, LOI is the average of live completes.', how: 'Enter the planned minutes from the client or your test.', where: 'Per market. Used for pricing, pace and the speeder check.' },
  'field:IR %': { title: 'IR %', what: 'Incidence rate: the share of people who qualify.', how: 'Enter the expected percentage, for example 30.', where: 'Per market. The monitor warns when the real IR is lower.' },
  'field:IR': { title: 'IR', what: 'Incidence rate. In reports: completes ÷ (completes + terminates) for the rows shown.', how: 'Compare it with the planned IR of the project.', where: 'Reports and the market table.' },
  'field:Completes': { what: 'How many completed interviews the client wants.', how: 'Enter the target number.', where: 'Per market. When reached, the market closes to new respondents.' },
  'field:Client CPI': { title: 'Client CPI', what: 'Cost per interview: what the client pays you for each complete.', how: 'Enter the price in the project\'s CPI currency.', where: 'Per market. Drives revenue and invoices.' },
  'field:Payout CPI': { title: 'Payout CPI', what: 'What you pay the vendor for each accepted complete.', how: 'Enter the price per complete. It cannot be higher than the client CPI unless allowed.', where: 'Per vendor per market. Drives vendor payables.' },
  'field:CPI currency': { what: 'The currency for client CPI and payout on this project.', how: 'Pick one currency for the whole project.', where: 'All markets. Reports can convert to your reporting currency.' },
  'field:Target completes': { what: 'The most completes this vendor may deliver in this market.', how: 'Enter a number. When reached, the vendor\'s link stops letting people in.', where: 'This vendor in this market.' },
  'field:Link variable': { what: 'The name of the URL parameter that carries the respondent ID in the vendor\'s link, for example uid or rid.', how: 'Use what the vendor expects. Web vendors usually use vid, API vendors uid.', where: 'Entry links and redirects for this vendor.' },
  'field:Live survey link': { what: 'The client\'s real survey URL.', how: 'Paste the link the client gave you. It must carry the respondent token.', where: 'Per market. Used once the market is live.' },
  'field:Test survey link': { what: 'The client\'s test survey URL.', how: 'Paste the test link to check the journey in QA studio.', where: 'Per market. Used while testing.' },
  'field:Target group': { what: 'Who the market is for, for example "General population" or "IT decision makers".', how: 'Pick or type a group.', where: 'With country and language it makes a market.' },
  'field:Country': { what: 'The country of the market.', how: 'Search and pick the country.', where: 'With language and target group it makes a market.' },
  'field:Language': { what: 'The survey language in this market.', how: 'Pick the language.', where: 'Per market.' },
  'field:Fieldwork dates': { what: 'When fieldwork starts and ends.', how: 'Pick start and end dates; the monitor uses them for pace.', where: 'Whole project.' },
  'field:Field start': { what: 'The first day of fieldwork.', how: 'Pick a date.', where: 'Whole project.' },
  'field:Field end': { what: 'The last day of fieldwork.', how: 'Pick a date; the monitor sets daily pace from it.', where: 'Whole project.' },
  'field:Bid reference (SampBidx)': { what: 'The SampBidx bid this project came from.', how: 'Pick the bid to link it.', where: 'Reports and won bids.' },
  'field:Work order no.': { what: 'Your work order number for the project. Generated with your prefix (e.g. FR9132), or typed by hand.', how: 'Leave Generate ticked for the next number, or type one. It must not be used by another project. Edit it later on the Overview tab.', where: 'Whole project, invoices and reports. Prefix and next number: Settings → Work orders and UID prefix.' },
  'field:Work order prefix': { what: 'The letters every generated work order starts with, e.g. FR or WO-.', how: 'Type 1 to 12 letters or digits; - _ and / are allowed after the first one.', where: 'New work orders only. Existing projects keep theirs.' },
  'field:Next number': { what: 'The number the next generated work order gets.', how: 'Set it to continue your old numbering. It cannot be one already used.', where: 'Next projects with Generate ticked.' },
  'field:Last work order given': { what: 'The work order the latest project got, generated or typed.', how: 'Use it to check the numbering continues where you expect.', where: 'Read only.' },
  'field:UID prefix': { what: 'Letters put in front of every respondent ID (UID) sent to client surveys, for your branding, e.g. SMP-.', how: 'Type up to 12 letters, digits, - or _. Leave empty for none.', where: 'Respondents who enter from now on, in every project.' },
  'field:Project manager': { what: 'Who runs this project day to day.', how: 'Pick a team member.', where: 'Shown in lists and reports.' },
  'field:Sales person': { what: 'Who sold this project.', how: 'Pick a team member.', where: 'Used in reports.' },
  'field:Project name': { what: 'The name your team uses for this project.', how: 'Keep it short and clear. Vendors can be shown a different vendor title instead.', where: 'Lists, reports and invoices.' },
  'field:Category': { what: 'The study category, for example B2B or Healthcare.', how: 'Pick or add a category.', where: 'Used for filtering and reports.' },
  'field:Project type': { what: 'The kind of study, for example ad-hoc or tracker.', how: 'Pick a type.', where: 'Used for filtering and reports.' },
  'field:Client': { what: 'The client this project is for, shown with its logo. Only active clients are listed.', how: 'Search by name, or type a new name and choose “+ Add” to save a new client without leaving the form.', where: 'Reports, invoices and the client portal. Make a client active again on the Clients page.' },
  'field:Client contact': { what: 'The person at the client you work with. Their email shows masked, e.g. p•••e@client.com.', how: 'Pick a contact, or type a new name and choose “+ Add” to save one to the client.', where: 'This project. Full details are on the Clients page.' },
  'field:Vendor': { what: 'The panel company that sends respondents.', how: 'Pick a vendor.', where: 'The chosen market or project.' },
  'field:How many links': { what: 'How many single-use links to create.', how: 'Enter up to 50,000 per batch.', where: 'The chosen vendor and market.' },
  'field:Stop working after (optional)': { what: 'A date after which these links stop working.', how: 'Leave empty for no expiry.', where: 'This batch only.' },
  'field:Vendor and market': { what: 'Which vendor and market the links are for.', how: 'Pick one pair.', where: 'Completes and payouts are counted for this vendor.' },
  'field:Test UID': { what: 'A made-up respondent ID for testing.', how: 'Leave the suggested one or type your own.', where: 'Test traffic only.' },
  'field:Qualifies from': { what: 'The lowest answer that qualifies.', how: 'Enter a number.', where: 'This question.' },
  'field:Qualifies up to': { what: 'The highest answer that qualifies.', how: 'Enter a number.', where: 'This question.' },
  'field:Question ID': { what: 'A short code for this question, used in quotas and exports.', how: 'Keep it short, for example AGE.', where: 'This project.' },

  // ───────────── Security checks (Create project; also on Gate & security) ─────────────
  'check:gateSurvey': { what: 'Short questions SampTrek asks before the client survey.', how: 'Turn on, then add questions here or in Gate & security.', where: 'Every respondent of the project. Answers can drive quotas.' },
  'check:prescreening': { what: 'Extra screening questions after the gate survey.', how: 'Turn on and add questions in Gate & security.', where: 'Every respondent of the project.' },
  'check:urlProtection': { what: 'Vendors sign every entry link, so respondent IDs cannot be made up or swapped.', how: 'Turn on and give vendors the signing instructions from Gate & security.', where: 'Every vendor of the project. Unsigned links are refused.' },
  'check:geolocation': { what: 'Respondent must be in the survey country.', how: 'Turn on for country-specific studies.', where: 'Each market checks its own country.' },
  'check:browserFingerprinting': { what: 'Spots the same device coming back, from screen, hardware and browser traits.', how: 'Turn on to catch repeat respondents who change IP.', where: 'Whole project.' },
  'check:captcha': { what: 'A free human check plus a background proof-of-work that slows down scripts.', how: 'Turn on and pick the style in Gate & security.', where: 'Shown on the gate page.' },
  'check:duplicateDetection': { what: 'Stops the same IP address and browser entering the project twice.', how: 'Keep on for most studies.', where: 'Whole project, across all vendors.' },
  'check:browserLanguage': { what: 'One of the browser languages must match the survey language.', how: 'Turn on when language matters.', where: 'Each market checks its own language.' },
  'check:timezoneTracking': { what: 'The device time zone must belong to the survey country.', how: 'Turn on with Geolocation for stronger location checks.', where: 'Each market checks its own country.' },
  'check:torDetection': { what: 'Blocks connections through the TOR network.', how: 'Turn on to stop anonymous traffic.', where: 'Whole project.' },
  'check:cookieValidation': { what: 'Needs cookies on, and catches the same browser coming back.', how: 'Turn on as an extra duplicate check.', where: 'Whole project.' },

  // ───────────── Apply to all, copy, Android/iOS (follow-up to the first help PR) ─────────────
  'bulk.markets': {
    title: 'Apply to all markets',
    what: 'Changes LOI, IR, CPI, completes or survey links for many markets in one go.',
    how: 'Fill in only the boxes that should change and press Apply. Tick rows first to change just those markets.',
    where: 'All markets shown, or only the ticked ones. Empty boxes leave values as they are.',
  },
  'bulk.vendorLinks': {
    title: 'Apply to all vendor links',
    what: 'Changes payout, target completes or link variable on many vendor links at once, and pauses or resumes them together.',
    how: 'Pick a vendor and/or market (or leave All), fill only what should change, then Apply. Use Pause or Resume to stop or restart those links.',
    where: 'Every vendor link that matches the vendor and market you picked on this project.',
  },
  'bulk.everyStatus': {
    title: 'One URL for every status',
    what: 'Sends every status (Complete, Terminate, Over quota, Security…) to one custom URL.',
    how: 'Paste one URL and Apply. Put {status} in it to pass the outcome. Reset to prebuilt puts every status back on the vendor\'s saved redirect.',
    where: 'The project status matrix. Country and vendor overrides still win.',
  },
  'bulk.createVendors': {
    title: 'Apply to all vendors',
    what: 'Gives every vendor on the new project the same payout or link variable.',
    how: 'Fill in the payout or link variable and Apply; change single vendors after.',
    where: 'All vendors listed on Create project, in every market.',
  },
  'vendors.copyAll': {
    title: 'Copy all links',
    what: 'Copies every vendor\'s live and test entry links for every market in one go.',
    how: 'Click, then paste into an email or sheet. Small copy icons next to a single link or ID copy just that one.',
    where: 'All vendors and markets of this project.',
  },
  'vendors.addEveryMarket': {
    title: 'Add to every market',
    what: 'Adds this vendor to all markets of the project at once, with the same payout and target.',
    how: 'Tick it before saving; change one market later if needed.',
    where: 'Every market of this project.',
  },
  'redirect.override.country': {
    title: 'Override: country',
    what: 'Which market this override is for.',
    how: 'Pick one country, Any, or Every market to make one rule for each market at once.',
    where: 'Overrides beat the project matrix: vendor + country first, then vendor, then country.',
  },
  'redirect.override.vendor': {
    title: 'Override: vendor',
    what: 'Which vendor this override is for.',
    how: 'Pick one vendor, Any, or Every vendor to make one rule for each vendor at once.',
    where: 'This project\'s redirects for that vendor.',
  },
  'redirect.override.status': {
    title: 'Override: status',
    what: 'Which outcome this override is for, such as Complete or Terminate.',
    how: 'Pick one status, or Every status to make one rule for each status at once.',
    where: 'Only respondents who end with that status.',
  },
  'device.allowed': {
    title: 'Devices allowed',
    what: 'Which devices may take this survey: desktop, mobile and tablet, and for mobile, Android and/or iPhone.',
    how: 'Switch a device off to stop it. Under Mobile, untick Android or iOS to allow only one kind of phone.',
    where: 'Every market and vendor of this project. Blocked devices get the Terminate page.',
  },
  'device.mobileOs': {
    title: 'Android and iOS',
    what: 'Which phone systems are let in when Mobile is allowed.',
    how: 'Keep both ticked for all phones. Untick one to allow only Android phones or only iPhones. At least one must stay ticked.',
    where: 'Phones only, for every market of this project. Other phone systems get in only when both are ticked.',
  },
  'quota.device': {
    title: 'Device quota',
    what: 'Limits completes by device: Desktop, Mobile, Tablet, Android phone or iPhone (iOS).',
    how: 'Pick the devices this cell counts. Android phone and iPhone are kinds of Mobile, so do not mix them with Mobile in one split.',
    where: 'This market. Quick add on Device makes Desktop / Mobile / Tablet cells only.',
  },
  'field:Quick add: one cell per answer of': {
    title: 'Quick add',
    what: 'Makes one quota cell for each answer of a question or for each device, with the market target shared evenly.',
    how: 'Pick the question or Device, then adjust each cell\'s limit.',
    where: 'This market.',
  },

  // ───────────────────────── Other sections ─────────────────────────
  'section:Finance: currency and tax': { what: 'Your reporting currency, FX rates and default tax.', how: 'Pick the reporting currency and keep exchange rates up to date.', where: 'Reports, dashboard and invoices.' },
  'settings.invoiceProfile': { title: 'Invoice details', what: 'Your legal name, address, tax ID and payment details printed on invoices.', how: 'Fill them in once and save.', where: 'Every client invoice PDF.' },
  'section:Captcha providers': { what: 'Free captcha services used for the human check.', how: 'Add the site key and secret from the provider.', where: 'Projects that use that captcha style.' },
  'section:Redirect security policy': { what: 'Which web addresses redirects may send respondents to.', how: 'List allowed domains, one per line, and set a fallback URL.', where: 'Every project; it always applies.' },
  'section:SampBidx connection': { what: 'Lets won bids arrive from SampBidx.', how: 'Copy the webhook URL and secret into SampBidx.', where: 'Won bids page.' },
  'section:Fieldwork alerts': { what: 'Where monitor alerts are sent.', how: 'Add an HTTPS URL to get alerts in your own system.', where: 'All projects.' },
  'section:Sign-in security': { what: 'Rules for how staff sign in.', how: 'Require two-step sign-in for staff if you want.', where: 'All staff.' },
  'section:Single sign-on': { what: 'Sign in with Google, Microsoft or Zoho.', how: 'Add your company domains and turn on the providers you use.', where: 'Staff whose email matches the domains.' },
  'section:AI copilot': { what: 'Limits for the AI copilot.', how: 'Turn it on or off and set daily limits.', where: 'All staff.' },
  'section:API keys': { what: 'Keys other systems use to read SampTrek data.', how: 'Create a key with only the scopes needed and copy it once.', where: 'The public API.' },
  'section:Webhooks': { what: 'URLs SampTrek calls when something happens.', how: 'Add a URL and pick events; check deliveries.', where: 'Your organisation.' },
  'section:Two-step sign-in': { what: 'A code from an authenticator app on top of your password.', how: 'Scan the QR code, enter the code, and save the recovery codes.', where: 'Your login only.' },
  'section:Password': { what: 'Your sign-in password.', how: 'Enter the current one and the new one twice.', where: 'Your login only.' },
  'section:What to export': { what: 'Which records to send to accounting.', how: 'Pick the type, period and format.', where: 'Invoices, bills and payments.' },
  'section:Export history': { what: 'Every export done so far.', how: 'Download an earlier export again.', where: 'Your organisation.' },
  'section:Account names': { what: 'The ledger account names used in exports.', how: 'Match them to your chart of accounts.', where: 'All accounting exports.' },
  'section:Zoho Books sync': { what: 'Sends invoices and payments straight to Zoho Books.', how: 'Connect in Integrations, then Sync now or let it run hourly.', where: 'Your organisation.' },
  'section:Xero, QuickBooks and Tally sync': { what: 'Sends invoices and bills straight to Xero, QuickBooks or Tally.', how: 'Connect the service, then Sync.', where: 'Your organisation.' },
  'section:Payment statements': { what: 'Statements of what you owe each vendor.', how: 'Pick a vendor and period.', where: 'Also shown in the vendor portal.' },
  'section:New client': { what: 'Adds a client company.', how: 'Fill name, contact and billing details. Suggestions help fill the rest.', where: 'Available on all projects.' },
  'section:New vendor': { what: 'Adds a panel company.', how: 'Fill name, contact and redirect URLs.', where: 'Available on all projects.' },
  'section:New portal user': { what: 'Creates a portal login.', how: 'Pick client or vendor, name, email and a temporary password.', where: 'That client or vendor\'s portal.' },
  'section:Compliance documents': { what: 'Vendor documents with an expiry date, such as ISO or GDPR certificates.', how: 'Upload, set the expiry and get reminded before it runs out.', where: 'This vendor.' },
  'section:Recent links': { what: 'This vendor\'s latest entry links on projects.', how: 'Open a project from here.', where: 'This vendor.' },
  'section:Sign-up link': { what: 'A link panel companies use to apply as a vendor.', how: 'Copy and share it; applications appear below.', where: 'Your organisation.' },
  'section:Schedules': { what: 'All scheduled report emails.', how: 'Edit, pause or delete a schedule.', where: 'Your organisation.' },
  'section:Write to a client or vendor': { what: 'Starts a new request.', how: 'Pick who, the subject and write the message.', where: 'They get an email and see it in their portal.' },
  'section:New task': { what: 'Adds a to-do.', how: 'Write it and pick an optional reminder date.', where: 'Your tasks.' },
  'section:Workspace': { what: 'Your organisation at a glance.', how: 'Click a number to open the list.', where: 'Your organisation.' },
  'section:Markets': { what: 'Where your traffic comes from on a world map.', how: 'Hover a country for numbers.', where: 'All live projects.' },
  'section:Traffic by weekday and hour': { what: 'When respondents come in.', how: 'Find the busiest hours to plan launches.', where: 'All projects.' },
  'section:Vendor payables': { what: 'What you owe vendors right now.', how: 'Open Payables to bill or pay.', where: 'All vendors.' },
  'section:Outcome mix': { what: 'The share of completes, terminates, over quotas and security fails.', how: 'Check for unusual mixes.', where: 'The chosen filters.' },
  'section:Completes per day (UTC)': { what: 'Completes each day.', how: 'Look for drops or spikes.', where: 'The chosen filters.' },
  'section:Gate survey and prescreener answers': { what: 'How respondents answered SampTrek questions.', how: 'Compare against your quota cells.', where: 'The chosen filters.' },
  'section:Outcomes routed': { what: 'How many respondents were sent to each kind of destination.', how: 'Check that most go to vendor URLs.', where: 'The chosen projects.' },
  'section:Why redirects fell back': { what: 'Reasons a respondent got the fallback page.', how: 'Fix the most common reason first.', where: 'The chosen projects.' },
  'section:Vendor callbacks': { what: 'Server-to-server calls sent to vendors and whether they worked.', how: 'Look for failing vendors and check their URL.', where: 'The chosen projects.' },
  'section:Redirects over time': { what: 'Redirect results by day.', how: 'Look for days with many fallbacks.', where: 'The chosen projects.' },
};

// ───────────────────────────── Lookup ─────────────────────────────

/** Turns /projects/abc123/x into the route key used above (/projects/[id]/x). */
export function routeKey(path: string): string {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  if (HELP[`page:${clean}`]) return clean;
  const parts = clean.split('/');
  for (const key of Object.keys(HELP)) {
    if (!key.startsWith('page:')) continue;
    const route = key.slice(5).split('/');
    if (route.length === parts.length && route.every((seg, i) => seg === parts[i] || /^\[.+\]$/.test(seg))) return key.slice(5);
  }
  return clean;
}

export function findHelp(id: string): HelpEntry | null {
  return HELP[id] ?? null;
}

export function helpForPage(path: string): HelpEntry | null {
  return HELP[`page:${routeKey(path)}`] ?? null;
}

export function helpForTab(tab: string): HelpEntry | null {
  const e = HELP[`tab:${tab}`];
  return e ? { title: tab, ...e } : null;
}

function scoped(kind: 'section' | 'field', name: string, path: string): HelpEntry | null {
  const route = routeKey(path);
  return HELP[`${kind}:${route}::${name}`] ?? HELP[`${kind}:${name}`] ?? null;
}

export function helpForSection(title: string, path = '/'): HelpEntry | null {
  return scoped('section', title.trim(), path);
}

/** "Client CPI (USD) *" → tries "Client CPI (USD)", then "Client CPI". */
export function helpForField(label: string, path = '/'): HelpEntry | null {
  const name = label.replace(/\s*\*\s*$/, '').trim();
  const e = scoped('field', name, path) ?? scoped('field', name.replace(/\s*\([^)]*\)\s*$/, '').trim(), path);
  return e ? { title: name, ...e } : null;
}
