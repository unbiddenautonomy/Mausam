# Admin app: UI plan

The people using this app are busy, on a phone, often mid-task, and many aren't comfortable with technology. Every screen should answer "what do I do now?" without reading. These are the rules we design to, what's done, and what's next.

## Principles

1. **One obvious next step.** Each screen has one big primary button. Secondary actions are smaller and lower.
2. **Say it with colour and words together.** Green = done, amber = in progress, red = late or wrong. Always with a word ("Late"), never colour alone.
3. **Big targets.** Buttons at least 52 px tall (56 px for the main action), tiles instead of dropdowns for choices.
4. **Read numbers back.** Money is where mistakes cost. Show what was typed in Indian format (₹1,25,000) and check sums live.
5. **Explain a disabled button.** If Save is greyed out, say what's missing right above it.
6. **Never lose work.** Drafts are kept on the phone, entries queue offline, and a crash shows a calm reload screen.
7. **Same words everywhere, in three languages.** No English-only labels on staff screens.

## Done in this round

| Change | Where | Why |
| --- | --- | --- |
| **"Next up" card** with a big button (Start shopping / Close the day). Turns red with "Late" when past due. | Manager's Today | Opens the app → one tap to the right task. |
| **Late status** on the task list | Today | Before, a missed deadline looked the same as "Pending". |
| **"All done" message** when shopping and closing are finished | Manager's Today | A clear finish line. |
| **Amount read-back** ("You typed ₹12,500") under money fields from ₹1,000 up | All money fields | Catches an extra or missing zero. |
| **Save bar** with a solid backing and a hint when disabled ("Enter the amount and pick what it was for") | Add expense, attendance | The button used to float see-through over the form and gave no reason it was off. |
| **Photos load again** in lists and on closing reports | Expenses, shopping, closing | Saved photos needed the login token, which plain images can't send, so they showed broken. |
| **Crash screen** with "Reload the app" | Whole app | Instead of a blank white page. |
| **Clear login errors** ("Too many wrong tries, wait 15 minutes") and the setup-code field | Login | Before, a lockout looked like a wrong PIN. |

Screenshots of these are in the pull request.

## Next (proposed, in priority order)

1. **Close the day as steps.** Split the long form into 3 short screens: photo of memo → four numbers (with the live check) → confirm. A progress bar at top. Highest value: it's the most important daily entry and the longest form.
2. **Number pad for money.** A big on-screen keypad (like a calculator) on amount fields, so the phone keyboard with letters never appears.
3. **Category icons.** A small picture on each expense tile (vegetables, milk, gas cylinder) so staff can recognise them without reading. Most-used categories first, per manager.
4. **"Update ready" banner.** When a new version is published, show "New version ready, tap to update" instead of waiting for the phone to refresh by itself.
5. **Undo instead of "Are you sure?".** After deleting an expense, show "Deleted · Undo" for a few seconds.
6. **Owner's Today: alerts first.** Put "Needs a look" above the numbers when anything is flagged, and collapse it when all is fine.
7. **Text size setting** (Normal / Large) under More, for staff who struggle with small text.
8. **Short voice note** on an expense instead of typing a note (stored like photos).
9. **Dark mode check.** Colours are defined for dark mode already; go screen by screen and fix any contrast misses.

Items 1 to 4 are worth doing before or right after launch. The rest can wait for feedback from the managers after the first two weeks: watch which screens they ask for help with.
