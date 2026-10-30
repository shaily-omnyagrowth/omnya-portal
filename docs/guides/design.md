# Design context

## Users
- **Owners and account managers** run a UGC agency day to day: they approve users, review creator submissions, manage campaigns, clients and payouts. They spend hours in the portal and need dense, scannable screens and fast actions.
- **Creators** check in from their phones between shoots: find jobs, submit videos, see how their videos perform and get paid. They need clear next steps and plain language.
- **Clients (brands)** check delivery and results: campaign pacing, delivered content, views and engagement. They need confidence that the agency is delivering.

## Brand Personality
Calm, precise, premium. The voice is short, direct and in sentence case. No emoji, no em dashes, no hype. Guidance copy tells people what happens next, not how great the feature is.

## Aesthetic Direction
- Light theme only. Tokens are structured so a dark theme can be added later.
- Monochrome palette: warm off-white ground `#F7F5F4`, near-black ink `#0A0A0A`, and the silver chrome from the logo for highlights. Colour appears only to carry meaning: green for ok, amber for pending, red for errors, blue for info.
- Primary actions are ink black.
- One variable grotesk with tabular figures for numbers.
- Flat white cards with hairline borders. Only hero cards get the stacked "card behind" shadow.
- Hugeicons, used only where an icon helps you find something faster.
- References for density and quiet confidence: Mercury, Linear, Attio, the Stripe dashboard.
- Anti-references: gradient-heavy AI dashboards, glassmorphism, emoji in labels, all-caps display headings everywhere, rainbow stat cards, shadows on everything.

## Design Principles
1. **Content before chrome.** Numbers, videos and names carry the screen; decoration earns its place or goes.
2. **Every screen answers "what do I do next".** Each one has a page header with one line of guidance, a single primary action, and empty states that point to the next step.
3. **Never lose the user's place.** Saves update in the background with toast feedback; no full-screen spinners or remounts. Skeletons match the real layout.
4. **Motion explains, never performs.** Short, interruptible transitions for state changes, springs for sheets and drawers, and reduced motion is respected.
5. **WCAG 2.2 AA, phone first.** 4.5:1 text contrast, visible focus, everything reachable by keyboard, colour never the only signal, and 44px touch targets.
