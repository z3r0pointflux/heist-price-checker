# Changelog

## v1.5.0 — 2026-08-09

**Startup notification.** The app now confirms it is running instead of only
adding a tray icon. A small panel appears in the bottom-right corner on launch
showing the hotkey and whether prices loaded, then fades out on its own. It is
click-through, so it can never swallow a click meant for the game, and it can be
turned off in Settings.

If the hotkey could not be registered — usually because another program already
owns it — the notification says so. Previously that only appeared in the log, and
the app just looked dead.

**Fixed: `Orb of …` currency never priced.** Any OCR crumb left beside the name
(`ORB OF ANNULMENT  gif`) pushed the match out of range, so the item came back as
"couldn't identify". The crumb-stripping meant to handle this cut short leading
words as well, so removing a trailing crumb also removed the `ORB OF`, leaving a
bare `ANNULMENT` that then failed the length check. Both ends are now trimmed
independently. Affected the whole family — Annulment, Scouring, Fusing,
Alteration, Alchemy, Regret, Chance.

**Fixed: white-named items unreadable over a bright background.** An
`Influencing Scarab of Interference` on a lit curio shelf returned nothing. Two
places assumed an item's name and its border are always colour-tinted, which is
true of uniques, rares and currency but not of normal rarity, whose name is plain
white on a plain grey border. The name box was never located, and the fallback
whole-region read cannot pick light grey text off a lit background. Both the
border detector and the colour mask now accept flat neutrals.

**Prices refresh hourly** rather than every 30 minutes, in the background and
before any price check, so a shown price is at most an hour old.

Regression corpus is now 35 real captures, replayed end to end from screenshot to
price on every test run.

## v1.4.0 — 2026-08-08

Scarabs price correctly, along with 10 further categories that were never fetched
at all: essences, fossils, oils, divination cards, delirium orbs, omens,
artifacts, resonators, tattoos and allflame embers. poe.ninja serves these from a
different endpoint family than the one the app was using. Price cache grew from
~22.2k to ~23k items.

Full UI redesign of the overlay and settings window, with a palette measured from
real captures rather than chosen.

## v1.3.3 — 2026-08-05

Pressing the hotkey with no tooltip on screen reported scenery noise as if an
item had been found. It now distinguishes "no tooltip" from "unreadable".

## v1.3.2 — 2026-08-05

Item matches are ranked by match quality rather than by position in the tooltip,
which had let a stray fragment outrank a correctly read item name.

## v1.3.1 — 2026-08-05

Fixed rare items being priced as uniques.

## v1.3.0 — 2026-08-05

Restored pricing for league 3.29 (Allflame) after poe.ninja retired the old API,
and rewrote item-name detection: names are drawn in the rarity colour and have
almost no brightness contrast, so reading them needs a colour mask rather than
plain greyscale. Prices now report the lowest listing rather than the median.

## v1.1.2 — 2026-03-16

Curio Display app icon; desktop and start menu shortcuts in the installer.

## v1.1.1 — 2026-03-16

Fixed the league dropdown.

## v1.1.0 — 2026-03-10

Tray icon fix, installer improvements, logging, developer docs.

## v1.0.0 — 2026-03-05

First release.
