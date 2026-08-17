/**
 * The hero zone — everything between the felt and the player.
 *
 * The action bar and its fixed strip (one coach line, one price chip), the two
 * hole cards, and the four-slot table header. All presentational: they render
 * decisions the engine and the Presenter have already made.
 *
 * Styles: `import "@poker/table-ui/hero.css"` (after `@poker/ui`'s tokens.css
 * and components.css).
 */

export { ActionBar, aggressionBounds, aggressionLabel, commitLabel, passiveLabel } from "./ActionBar";
export type { ActionBarProps } from "./ActionBar";

export { CoachLine } from "./CoachLine";
export type { CoachLineProps } from "./CoachLine";

export { PriceChip, formatNeed, formatRatio, priceLabel } from "./PriceChip";
export type { PriceChipProps } from "./PriceChip";

export { HeroCards } from "./HeroCards";
export type { HeroCardsProps } from "./HeroCards";

export { HEADER_SLOTS, HEADER_SLOT_BUDGET, TableHeader } from "./TableHeader";
export type { HeaderSlot, NetUnit, TableHeaderProps } from "./TableHeader";

export { KEY_MAP, KeyMapOverlay } from "./KeyMapOverlay";
export type { KeyMapOverlayProps } from "./KeyMapOverlay";

export type { PriceState, SizePreset } from "./types";
