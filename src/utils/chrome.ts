/**
 * Page-chrome geometry — the heights a full-viewport visualization has to
 * subtract to sit *between* the sticky header and the footer instead of
 * running under them.
 *
 * These constants were previously copy-pasted into every story/chart component
 * and had already drifted between projects. Import them instead.
 *
 * The reactive parts (`isMobile`, `headerH`, `footerH`) deliberately stay in the
 * component: they depend on `bind:clientWidth` and on `footerState`, both of
 * which are component-local. Typical usage:
 *
 *   import { MOBILE_BREAKPOINT, FOOTER_H, headerHeight } from "$utils/chrome";
 *   import { footerState } from "$utils/footerState.svelte";
 *
 *   let width = $state(1024);
 *   let isMobile = $derived(width <= MOBILE_BREAKPOINT);
 *   let headerH = $derived(headerHeight(isMobile, progressBar));
 *   let footerH = $derived(footerState.visible ? FOOTER_H : 0);
 */

/** Viewport width at or below which the mobile layout applies. */
export const MOBILE_BREAKPOINT = 768;

/** Sticky site header (Header.svelte), excluding any progress bar. */
export const HEADER_H = { mobile: 48, desktop: 65 };

/** Scroll-progress bar, when the story has one. See `headerHeight`. */
export const PROG_BAR_H = 52;

/** Measured height of Footer.svelte. Pair with `footerState.visible`. */
export const FOOTER_H = 54.6;

/**
 * Total height of everything sticky at the top of the page.
 *
 * `progressBar` is per-story: bigger features usually drop the bar to reclaim
 * vertical space, so it's a parameter rather than baked into HEADER_H.
 *
 * NB: the bar only adds height on desktop. That mirrors the existing
 * implementation (tsca-cbi story.svelte, which used
 * `{ mobile: 48, desktop: 65 + PROG_BAR_H }`), on the assumption that the bar is
 * hidden on mobile. If a project *does* show it on mobile, add PROG_BAR_H to
 * both branches here.
 */
export function headerHeight(isMobile: boolean, progressBar = false): number {
	if (isMobile) return HEADER_H.mobile;
	return HEADER_H.desktop + (progressBar ? PROG_BAR_H : 0);
}
