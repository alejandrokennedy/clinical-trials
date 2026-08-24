<script lang="ts">
	import "$styles/plot.css";
	import { footerState } from "$utils/footerState.svelte";
	import { MOBILE_BREAKPOINT, FOOTER_H, headerHeight } from "$utils/chrome";
	import {
		Plot,
		DifferenceY,
		AreaY,
		Line,
		Text,
		Dot,
		HTMLTooltip
	} from "svelteplot";
	import AnchoredTooltip from "$components/helpers/tooltip/AnchoredTooltip.svelte";
	import ScrolloSteps from "$components/helpers/ScrolloSteps.svelte";
	import chapters from "$data/plotStorySteps.json";
	import csv from "$data/australiaPhase1Trials.csv";
	import sponsorCsv from "$data/australiaSponsorCountry.csv";
	import { Tween } from "svelte/motion";
	import { cubicOut, cubicInOut } from "svelte/easing";
	import RefreshCopy from "$components/helpers/RefreshCopy.svelte";

	interface Props {
		copy?: any;
		darkMode?: boolean;
		progressBar?: boolean;
	}

	let {
		copy: initialCopy,
		darkMode = false,
		progressBar = false
	}: Props = $props();
	let copy = $state(initialCopy);
	const DOC_ID = "1WVnB5zR28cJgspAsq3rCqxWfd5ZKc0ifJtnBN0YVnyk";

	// Below this measured height the plot body computes negative and SveltePlot
	// throws on `<rect height="-…">`. See the render gate in the markup.
	const MIN_PLOT_H = 80;

	// Used from the config block down, so it lives above everything that needs it.
	const clamp = (v: number) => Math.min(1, Math.max(0, v));

	let width = $state(1024);
	let height = $state(800);
	let isMobile = $derived(width <= MOBILE_BREAKPOINT);
	let headerH = $derived(headerHeight(isMobile, progressBar));
	let footerH = $derived(footerState.visible ? FOOTER_H : 0);

	// Measured chart box. Plot can't size itself from CSS — it needs explicit
	// numbers — so bind the container and hand them over.
	//
	// `measured*` update on every resize frame; `chart*` are the *committed*
	// sizes we actually feed the plot, updated only once a resize settles. During
	// a live window-resize drag, feeding SveltePlot a new size every frame makes
	// its internal ResizeObserver ping-pong ("ResizeObserver loop … undelivered
	// notifications" → effect_update_depth_exceeded, which freezes the page).
	// Debouncing the commit — and pinning the figure to the committed pixel width
	// (see CSS) — keeps the plot's geometry stable through the drag.
	let measuredWidth = $state(400);
	let measuredHeight = $state(400);
	let chartWidth = $state(400);
	let chartHeight = $state(400);

	$effect(() => {
		const w = measuredWidth;
		const h = measuredHeight;
		// Apply the very first real measurement immediately; debounce the rest.
		const firstPaint = chartWidth === 400 && chartHeight === 400;
		if (firstPaint) {
			chartWidth = w;
			chartHeight = h;
			return;
		}
		const id = setTimeout(() => {
			chartWidth = w;
			chartHeight = h;
		}, 120);
		return () => clearTimeout(id);
	});

	// ── Data ──────────────────────────────────────────────────────────────────
	// Phase 1 clinical-trial counts by start year, normalized to trials per PER
	// residents: count / (pop / PER). Read straight from the source sheet
	// (`preliminary-data/Australia phase 1 trials data-2.xlsx`, tab 1, copied to
	// src/data) rather than re-keyed here, so there is one copy of the numbers.
	//   • Australia = clinicaltrials.gov + ANZCTR ("Total AUS trials").
	//   • Populations are PER YEAR, not fixed reference figures.
	//     Source: United Nations World Population Prospects, 2024.
	// The sheet's own per-million columns are ignored — they're computed from the
	// same counts and populations, and deriving them here keeps PER as the single
	// place the denominator lives (see below).

	// ── Rate unit ─────────────────────────────────────────────────────────────
	// The ONE place the denominator lives. Everything downstream is derived from
	// it — the series values, the y-domain, the gridline ticks and their fade
	// timing — so changing units is these two lines plus the axis label, not a
	// hunt through hardcoded numbers. (Was 1e5 / "100,000".)
	const PER = 1e6;
	const PER_LABEL = "million";

	// One column name per value we need. Spelled out because the sheet's headers
	// are prose ("USA trials (imported from other spreadsheet)") — a typo here is
	// a NaN in the chart, so they're named once and used once.
	const COL = {
		year: "Year",
		usCount: "USA trials (imported from other spreadsheet)",
		auCount: "Total AUS trials",
		usPop: "USA population per year",
		auPop: "Aus population per year"
	} as const;

	// Field names are deliberately unit-NEUTRAL (`usRate`, not `usPer100k`) so a
	// change of denominator doesn't ripple through every mark in the markup.
	// usCount/auCount ride along for the tooltip, which reports BOTH framings.
	// usPop/auPop ride along for the morph, which needs each year's own divisor.
	// None of the three are plotted.
	const data = csv.map((r) => {
		const usCount = +r[COL.usCount];
		const auCount = +r[COL.auCount];
		const usPop = +r[COL.usPop];
		const auPop = +r[COL.auPop];
		return {
			year: +r[COL.year],
			usRate: usCount / (usPop / PER),
			auRate: auCount / (auPop / PER),
			usCount,
			auCount,
			usPop,
			auPop
		};
	});

	// ── Sponsor breakdown (steps 4–5) ───────────────────────────────────────────
	// The Australian total split by the SPONSOR's country — same workbook, tab 3
	// ("Aus trials per country per year"), pasted the same way. The sheet has
	// already bucketed sponsors into these four, so this is the whole breakdown,
	// not a top-3-plus-rest computed here.
	//
	// The four bands SUM to auCount, year by year (verified against the workbook),
	// which is the property the whole step rests on: the top of the stack IS the
	// Australia line, so the line needs no adjustment when the fill arrives.
	// Bottom-to-top stacking order; the colours below ride in the same order.
	const SPONSORS = ["Australia", "United States", "China", "Other"];
	// Australia and the U.S. keep the exact hues they carry as lines, so a band
	// and its line are the same country. The other two are chosen against those:
	// the four pass the adjacent-pair CVD check in stacking order (worst pair
	// gold↔red, ΔE 12.2 deuteranopic, 17.9 normal).
	//
	// The gold replaces a purple that measured no darker (OKLab L 0.57, between
	// the blue and the red) but READ darker, because it was the least chromatic
	// hue on the chart sitting next to the lightest one. Lifting both lightness
	// and chroma is what actually fixed it, not a different purple.
	const SPONSOR_COLORS = ["#4575b4", "#d73027", "#d98a1f", "#2a9d8f"];
	// Display names. The data keys double as the desktop labels — they are the
	// sheet's own column headers and they read correctly — but the legend and the
	// in-band labels need the short forms at 390px, matching the abbreviation the
	// line-end label already uses ("Aus.").
	const SPONSOR_SHORT = ["Aus.", "U.S.", "China", "Other"];
	let sponsorLabels = $derived(isMobile ? SPONSOR_SHORT : SPONSORS);
	// Excel's pivot header for the year column, kept verbatim rather than renamed
	// in the CSV, so the file stays a straight paste of the sheet.
	const SPONSOR_YEAR = "Row Labels";

	// Cumulative band edges IN COUNTS — [c0, c1] per (year, sponsor). A blank cell
	// is a year with no trials from that country, not a gap: an area chart cannot
	// have holes, so it reads as 0. Kept in counts, not axis units, because the
	// axis scale is animated (see `axisPerCount`).
	const bands = sponsorCsv
		.filter((r) => /^\d{4}$/.test((r[SPONSOR_YEAR] ?? "").trim()))
		.flatMap((r) => {
			let acc = 0;
			return SPONSORS.map((sponsor) => {
				const c0 = acc;
				acc += +(r[sponsor] || 0);
				return { year: +r[SPONSOR_YEAR], sponsor, c0, c1: acc };
			});
		});

	// Each year's Australian total = the top of its last band. Used by the stack
	// tooltip (for the share) and by the invariant check below.
	const bandTotal = new Map(bands.map((b) => [b.year, b.c1]));

	// The stack landing on the line is an invariant across two separate files, and
	// it fails SILENTLY — the bands just stop reaching the line. So check it once.
	if (import.meta.env.DEV) {
		const off = data.filter((d) => bandTotal.get(d.year) !== d.auCount);
		if (off.length)
			console.warn(
				"[PlotStory] sponsor bands do not sum to the Australian total:",
				off.map((d) => `${d.year}: ${bandTotal.get(d.year)} vs ${d.auCount}`)
			);
	}

	// What actually gets drawn: year + the two plotted values, plus the two
	// populations, which the morph needs per row (counts stay behind for the
	// tooltip, which reads `data` — never the clipped/morphed array).
	type PlotRow = {
		year: number;
		usRate: number;
		auRate: number;
		usPop: number;
		auPop: number;
	};

	// Fixed scales so the frame stays put while the lines grow into it.
	const X0 = data[0].year;
	const X1 = data[data.length - 1].year;

	// Round the domain up to a clean tick above the tallest series, rather than
	// hardcoding it: at /million Australia peaks at ~13.66 in 2024, so this lands
	// on 14. Y_TICK_STEP is the gridline interval.
	const Y_TICK_STEP = PER / 1e6; // 1 per million; 0.1 per 100k — same tick count
	const PEAK = Math.max(...data.map((d) => Math.max(d.usRate, d.auRate)));
	const Y_MAX = Math.ceil(PEAK / Y_TICK_STEP) * Y_TICK_STEP;

	// ── Step 3 axis: absolute counts ────────────────────────────────────────────
	// Explicit rather than derived. d3's tick algorithm (and the inlined copy this
	// replaced) picks steps from the 1 / 2 / 5 × 10^k progression, so it can only
	// offer 500→2000 or 200→1600 here — it has no way to produce a QUARTER step.
	// 250 → 1750 is an editorial choice, so it's stated outright.
	//
	// Headroom check: the tallest count is the U.S. 1578 in 2021, which lands at
	// 90% of a 1750 axis. That's tighter than the old 2000 top (79%) but still
	// clears the frame — catmull-rom overshoot at that peak is ~0.1 axis units.
	// The tallest count is 1578; if it ever exceeds Y_MAX_COUNT the line would run
	// out of the top of the frame.
	const Y_MAX_COUNT = 1750;
	const COUNT_TICK_STEP = 250;

	// ── Step 4 axis: Australia alone ────────────────────────────────────────────
	// The zoom target. Australia peaks at 365 (2024), which lands at 91% of a 400
	// axis — the same headroom the U.S. peak has on 1750 (90%), so the two count
	// frames are cropped alike. 50 gives eight gridlines above the baseline.
	const Y_MAX_COUNT_AU = 400;
	const AU_COUNT_TICK_STEP = 50;

	// Both count tick sets are carried as COUNTS, not axis positions: step 4
	// animates the axis units per count, so their y has to be resolved per frame
	// (see `axisPerCount`) or the numbers would sit still while the data zoomed.
	// toFixed(2) not (1): at quarter steps 1250 would round to "1.3k". The unary +
	// then strips the trailing zeros again, so 1000 → "1k", 1500 → "1.5k".
	const countLabel = (v: number) =>
		v >= 1000 ? `${+(v / 1000).toFixed(2)}k` : String(v);
	const ticksTo = (max: number, step: number) =>
		Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
	const COUNT_TICKS = ticksTo(Y_MAX_COUNT, COUNT_TICK_STEP);
	const AU_COUNT_TICKS = ticksTo(Y_MAX_COUNT_AU, AU_COUNT_TICK_STEP);

	// Series colours (strong line + label colours; the fill uses the muted
	// RdYlBu scheme underneath). Passed with `scale: null` so SveltePlot uses
	// them literally instead of routing them through the colour scale.
	const US_COLOR = "#d73027"; // warm / red
	const AU_COLOR = "#4575b4"; // cool / blue

	// Difference-fill colours. SveltePlot ignores a colour-scale `range`, so these
	// are applied to the area paths via CSS custom properties (see the style block).
	// Light red to echo the US line; light blue for Australia. Tweak freely.
	const US_FILL = "#FFAFB3"; // light red / salmon
	const AU_FILL = "#92c5de"; // light blue

	// Muted colour for axis ticks + labels (applied as `color`/currentColor).
	const AXIS_MUTED = "#4b4b4b";
	const CURVE = "catmull-rom";

	// ── Config toggles ───────────────────────────────────────────────────────────
	// Show the ScrolloSteps text boxes (bg + shadow). Off while the steps are empty;
	// flip to true to pull the reference boxes back in.
	const SHOW_STEP_BOXES = false;
	// Scroll length of the step that drives the time-series animation (the 2nd
	// step). Longer → the reveal is spread over more scrolling.
	// Scroll length of the intro step. Restates ScrolloSteps' own default, but
	// stated here so all three step lengths sit together as pacing controls.
	const INTRO_STEP_PADDING = "60vh";
	const ANIM_STEP_PADDING = "100vh";
	// Scroll length of the 3rd step, which morphs the chart from per-capita rates
	// to absolute counts.
	const MORPH_STEP_PADDING = "100vh";
	// Scroll length of the 4th step (zoom onto Australia) and the 5th (the sponsor
	// stack fading in band by band).
	const ZOOM_STEP_PADDING = "100vh";
	const STACK_STEP_PADDING = "100vh";
	// When note 3 starts rising, as a fraction of step 3's progress. Mobile waits:
	// the lead note is only ~45px past its resting spot when step 3 begins and is
	// still scrolling out of the top, so note 3 holds off until it has cleared.
	const NOTE3_START_DESKTOP = 0.1;
	const NOTE3_START_MOBILE = 0.45;
	let note3Start = $derived(
		isMobile ? NOTE3_START_MOBILE : NOTE3_START_DESKTOP
	);
	// Notes 4 and 5 arrive the same way, and mobile waits for the same reason: the
	// note before it is still scrolling out of the top of the frame.
	const NOTE_START_DESKTOP = 0.1;
	const NOTE_START_MOBILE = 0.35;
	let noteStart = $derived(isMobile ? NOTE_START_MOBILE : NOTE_START_DESKTOP);

	// The morph's window INSIDE that step, as 0→1 fractions of its progress.
	// START is keyed to note 3's arrival rather than being a fixed number, so the
	// chart never rescales itself while the note explaining why is still off
	// screen. On desktop the two were already both 0.1, so this is a no-op there;
	// on mobile it holds the morph back from 0.1 to 0.45.
	//
	// MORPH_START_OFFSET nudges the two apart: negative = the chart starts moving
	// BEFORE the note lands, positive = the note lands first and the chart follows.
	// ±0.05 is roughly ±40px of scroll on a 780px phone.
	//
	// END at 1 means the morph uses the rest of the step and the container runway
	// after it is the beat — one fewer lever coupled to TAIL_TRIM.
	const MORPH_START_OFFSET = 0;
	const MORPH_END = 1.0;
	// Floored at 0 and kept clear of MORPH_END: if the two met, the window would be
	// zero-width and `q` would snap 0→1 in a single frame.
	const MORPH_MIN_SPAN = 0.05;
	let morphStart = $derived(
		Math.min(clamp(note3Start + MORPH_START_OFFSET), MORPH_END - MORPH_MIN_SPAN)
	);
	// Optional scroll smoothing, mirroring ANIM_TWEEN_MS (also 0 = follow scroll
	// exactly). Left at 0; raise if the morph reads as jittery on a trackpad.
	const MORPH_TWEEN_MS = 0;
	// q at which the y-axis changes meaning, and the fade span either side of it.
	// Both tick sets are invisible at the swap, so there is never a double grid.
	const LABEL_SWAP_AT = 0.5;
	const LABEL_FADE_SPAN = 0.18;
	// ── Step 4: the zoom onto Australia ─────────────────────────────────────────
	// The U.S. line and the difference band leave FIRST, over the opening
	// US_EXIT_SPAN of the step, and the zoom only starts once they are gone. That
	// ordering isn't taste: on a 400-count axis the U.S. peak (1,578) sits nearly
	// 4× above the frame, and it crosses the top rail about 3% into the zoom — far
	// too soon for any fade running alongside to finish first.
	const US_EXIT_SPAN = 0.18;
	const ZOOM_END = 0.92;
	// Same guard as MORPH_MIN_SPAN: keep the window from collapsing on mobile,
	// where the note arrives late and the zoom has less of the step left.
	const ZOOM_MIN_SPAN = 0.2;
	// The zoom cannot start before the U.S. is gone OR before the note explaining
	// it has landed, whichever is later.
	let zoomStart = $derived(
		Math.min(Math.max(US_EXIT_SPAN, noteStart), ZOOM_END - ZOOM_MIN_SPAN)
	);
	// Where the count ticks change meaning (1,750 frame → 400 frame), as a
	// fraction of the zoom, and the fade either side. Same V as LABEL_SWAP_AT:
	// both sets pass through zero, so the axis never carries two scales at once.
	const ZOOM_LABEL_SWAP_AT = 0.45;
	const ZOOM_LABEL_FADE_SPAN = 0.2;

	// ── Step 5: the sponsor stack ───────────────────────────────────────────────
	// The bands fade in from the bottom up, one every BAND_STAGGER of the step.
	// Only OPACITY animates — every band is drawn at its final stacked position
	// throughout, so the reveal reads as the area filling up from the baseline
	// rather than four shapes sliding around.
	const BAND_STAGGER = 0.12;
	const BAND_FADE_SPAN = 0.22;
	const STACK_END = 0.85;
	const STACK_MIN_SPAN = 0.3;
	let stackStart = $derived(Math.min(noteStart, STACK_END - STACK_MIN_SPAN));

	// How fast the 2014 crossover callout leaves once the morph starts. It is a
	// claim about the PER-CAPITA chart, and the crossing it points at begins
	// sweeping right at q ≈ 0.08, so it has to be gone early.
	const CROSS_EXIT_SPAN = 0.15;
	// Axis title once the chart is showing absolute counts, and again once it has
	// zoomed onto Australia alone.
	const Y_LABEL_COUNT = "Phase 1 trials started ↑";
	const Y_LABEL_COUNT_AU = "Phase 1 trials started in Australia ↑";
	// The axis title shares its line with the legend, which grows from two items
	// to four at exactly this point — at 390px the long form runs straight into
	// the first swatch. Shortened only here, where the collision is.
	const Y_LABEL_COUNT_AU_MOBILE = "Trials in Australia ↑";
	// How much of Scrollo's trailing runway to reclaim. That runway
	// (.scrollyContainer's padding-bottom, 100vh) is scroll where the chart is
	// still pinned but nothing is animating.
	//
	// Now applied on BOTH breakpoints, unlike the two-step version. Mobile used to
	// need the full runway for the lead note to finish scrolling out; step 3 gives
	// it 780px to do that long before the end, so the runway became dead scroll
	// there too (measured 1.04 viewports of it).
	//
	// 30vh lands both breakpoints at ~0.49 viewports of hold after the morph
	// finishes — enough to read the final chart without stalling. Measured:
	// desktop 215px → 440px, mobile 813px → 384px. Raise to trim more; 0vh
	// restores the original tail.
	//
	// Does NOT touch pacing — ANIM_STEP_PADDING / MORPH_STEP_PADDING are the
	// animations' own scroll lengths, and stepPx (the 1:1 note math) reads the
	// chart step, not this.
	const TAIL_TRIM = "30vh";
	// Mobile keeps the FULL runway. It isn't dead scroll there any more: note 3
	// persists its scroll rather than parking, so it is still travelling out
	// through that stretch — the same reason the old .lead-exit-runway existed.
	// Trimming it strands the note ~100px inside the frame at max scroll.
	const TAIL_TRIM_MOBILE = "0vh";

	// ── Progressive y-gridlines (fade in as the data grows tall enough) ──────────
	// Generated from the domain, not hand-listed, so a unit change can't leave the
	// ticks describing the old scale. toFixed guards float drift on fractional
	// steps (0.1 + 0.2 = 0.30000000000000004).
	const Y_TICKS = Array.from(
		{ length: Math.round(Y_MAX / Y_TICK_STEP) + 1 },
		(_, i) => +(i * Y_TICK_STEP).toFixed(10)
	);
	// Decimals needed to print a tick — 0 at /million, 1 at /100k. Keeps the
	// labels honest without a second hardcoded assumption about the unit.
	const TICK_DECIMALS = Y_TICK_STEP < 1 ? 1 : 0;
	const tickLabel = (t: number) => t.toFixed(TICK_DECIMALS);
	// Timing knobs: how soon each gridline/number fades in relative to the data
	// reaching it. Higher = sooner. Expressed as FRACTIONS OF THE AXIS rather than
	// raw data units — as literals they silently retimed the whole fade whenever
	// the scale changed (0.06 is a gentle lead on a 0→1 axis, a nearly invisible
	// one on 0→10).
	const TICK_LEAD = 0.06 * Y_MAX; // gridline appears a touch before the data reaches it
	const TICK_FADE_SPAN = 0.08 * Y_MAX; // span over which each gridline fades in
	// The x-year labels carry SveltePlot's built-in 0.8 axis-text opacity; match it
	// on our custom y-numbers so the two read the same.
	const AXIS_TEXT_OP = 0.8;

	// ── End-of-animation ramp ────────────────────────────────────────────────────
	// The top gridline/number (Y_MAX) fades in over the last TAIL_SPAN of the
	// reveal — the data stops just short of it, so it needs its own cue.
	const TAIL_SPAN = 0.06;

	// ── Year dots ────────────────────────────────────────────────────────────────
	// The dots pop in via their OWN time-based tween (not tied to scroll), fired
	// once the reveal passes DOT_TRIGGER. Scroll-tied growth made 26×2 dots re-render
	// every frame near the end → laggy; a one-shot tween avoids that.
	const SHOW_DOTS = true; // lever: flip to false to remove the year dots
	const DOT_R = 3; // full dot radius, px
	const DOT_TRIGGER = 1; // reveal fraction at which the dots start growing in
	const DOT_ANIM_MS = 450; // duration of the dot pop-in (its own clock)

	// ── Copy ────────────────────────────────────────────────────────────────────
	// Prose for the two overlay notes comes from copy.json, which `pnpm gdoc`
	// regenerates from the Google Doc (DOC_ID above; see google.config.js).
	//
	// Looked up by ArchieML `name`, NOT by array index — reordering the doc or
	// inserting a block above them would otherwise silently swap the two notes.
	// The text carries its own <span class="us"> / class="au"> markup, so it has
	// to be rendered with {@html}; the styling consequence of that is noted on the
	// .us/.au rules in the style block.
	const storyCopy = (name: string): string =>
		copy?.story?.find((d: { name: string }) => d.name === name)?.text ?? "";
	let introText = $derived(storyCopy("us"));
	let leadText = $derived(storyCopy("australia"));
	// NB: the ArchieML block is named "raw", not "absolute" — that is what the
	// Google Doc actually produced. A mismatch here fails silently (storyCopy
	// returns ""), so the note markup is guarded on the text being non-empty.
	let rawText = $derived(storyCopy("raw"));
	// Steps 4 and 5. Guarded in the markup the same way `raw` is — a renamed block
	// in the Google Doc turns into an empty white card on mobile, not an error.
	let zoomText = $derived(storyCopy("zoom"));
	let stackText = $derived(storyCopy("stack"));

	// ── Scroll wiring ───────────────────────────────────────────────────────────
	// ScrolloSteps reports the active step index and a 0→1 progress within it.
	let step = $state<number | null | undefined>(undefined);
	let stepProgress = $state<number | null | undefined>(undefined);

	// chapters[0] = intro (chart empty), chapters[1] = scrub through time,
	// chapters[2] = morph to absolute counts, chapters[3] = zoom onto Australia,
	// chapters[4] = fade in the sponsor stack.
	// NB: these indices are ALSO hardcoded as :nth-child literals in the style
	// block (a step's scroll length is CSS). Reorder or insert a step and both
	// must change together — nothing errors if they diverge, the wrong step just
	// gets the wrong scroll length, which only shows up as "the pacing feels off".
	const CHART_STEP = 1;

	// Every phase is a PARALLEL 0→1 over its own step, never an extension of the
	// one before: each has to stay pinned at its end state while the next runs, or
	// the finished chart would unwind underneath the new beat.
	const progressIn = (index: number) =>
		step == null || step < index ? 0 : step > index ? 1 : (stepProgress ?? 0);

	// Height of the animation step, in px — the scroll distance that one full unit
	// of `p` costs (Scrollo divides by exactly this). It's what lets the prose
	// notes below move at true 1:1 scroll rate. Measured rather than computed from
	// ANIM_STEP_PADDING so it stays right if that lever changes, and because `vh`
	// on mobile is the *large* viewport, not window.innerHeight.
	//
	// Safe to observe: this element's height comes from the viewport alone, never
	// from anything we derive out of stepPx — so unlike the chart box (see the
	// debounce above) there's no ResizeObserver feedback loop to break.
	let overlayEl = $state<HTMLDivElement | null>(null);
	let stepPx = $state(0);
	// The chart step's absolute position in the document. Needed (with stepPx) to
	// convert the crossover into a raw scrollY — see `handoffScrollY`.
	let stepTopPx = $state(0);

	// Trigger line ScrolloSteps is configured with. Kept as a number so the same
	// value feeds the component AND the scroll math below; Scrollo computes its
	// own triggerPointPx as `innerHeight * vh / 100`, so this must match.
	const SCROLLO_TOP_VH = 75;

	// Live scroll position / viewport height. Only read, never assigned.
	let scrollY = $state(0);
	let winH = $state(800);

	// Measure a scroll step's height and absolute document top. Both notes' scroll
	// anchoring needs the pair, and the two call sites below were previously an
	// exact clone of each other.
	//
	// Split deliberately into observe-once + re-measure-on-frame-change. Folding
	// them together meant `winH` was a dependency of the effect that OWNS the
	// observer, so every mobile URL-bar collapse tore down and rebuilt two
	// ResizeObservers and forced a synchronous layout — mid-scroll, which is the
	// one path in this file where that shows up as jank.
	function observeStep(index: number, apply: (h: number, top: number) => void) {
		const el = overlayEl?.querySelector<HTMLElement>(
			`.step:nth-child(${index + 1})`
		);
		if (!el) return;
		const measure = () =>
			apply(el.offsetHeight, window.scrollY + el.getBoundingClientRect().top);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}

	function measureStep(index: number, apply: (h: number, top: number) => void) {
		const el = overlayEl?.querySelector<HTMLElement>(
			`.step:nth-child(${index + 1})`
		);
		if (el)
			apply(el.offsetHeight, window.scrollY + el.getBoundingClientRect().top);
	}

	const setChartStep = (h: number, top: number) => {
		stepPx = h;
		stepTopPx = top;
	};

	$effect(() => observeStep(CHART_STEP, setChartStep));
	// A step's document top also shifts if anything above it reflows, so re-measure
	// on frame changes — without disturbing the observer above.
	$effect(() => {
		void winH;
		void width;
		measureStep(CHART_STEP, setChartStep);
	});

	let triggerPx = $derived((SCROLLO_TOP_VH / 100) * winH);

	// How far the intro note must travel to clear the top of the frame: its own
	// offset from the container top plus its height, so the whole card is past the
	// edge. Measured rather than a magic number — it tracks copy length and the
	// mobile card's padding. `transform` doesn't affect offsetTop/offsetHeight, so
	// reading them while the note is mid-slide is safe (and no feedback loop).
	let introEl = $state<HTMLParagraphElement | null>(null);
	let introExitPx = $state(0);
	const EXIT_SLACK = 8; // a few px past the edge, so no sliver of card shows

	$effect(() => {
		const el = introEl;
		if (!el) return;
		// Tracked reads: offsetTop is a percentage of the frame, so it moves when
		// the frame does. (ResizeObserver alone would miss a height-only change.)
		void height;
		void width;
		const measure = () =>
			(introExitPx = el.offsetTop + el.offsetHeight + EXIT_SLACK);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});

	// Target reveal amount (0 = year 2000, 1 = year 2025) from scroll position.
	// 0 before/at the intro, 1 once the scrub step is behind us.
	let target = $derived(progressIn(CHART_STEP));

	// A tween smooths scroll jitter into fluid line growth, but it also *trails* the
	// scroll by roughly this duration — the "slight lag" in the reveal. Lower it for
	// snappier tracking, raise it for more smoothing (0 = follow the scroll exactly).
	const ANIM_TWEEN_MS = 0;
	const reveal = Tween.of(() => target, {
		duration: ANIM_TWEEN_MS,
		easing: cubicOut
	});
	let p = $derived(reveal.current);

	// ── Step 3 progress (`q`) ───────────────────────────────────────────────────
	// A PARALLEL derivation, not an extension of `target`. `p` has to stay pinned
	// at 1 once the reveal finishes — clip(), decorationFade, endFade, crossFade,
	// dotGrow and the intro→lead note handoff all depend on that — so step 3 gets
	// its own 0→1 instead.
	//
	// Continuity: the instant `step` flips to MORPH_STEP, `stepProgress` is 0, so
	// `morphTarget` is 0 too. No seam, and it reverses cleanly on scroll-up.
	const MORPH_STEP = 2;
	let morphTarget = $derived(progressIn(MORPH_STEP));
	const morph = Tween.of(() => morphTarget, {
		duration: MORPH_TWEEN_MS,
		easing: cubicOut
	});
	// cubicInOut, not linear: the whole "who leads" band reversal happens in the
	// first half of q (2017 flips at q≈0.08, 2025 at q≈0.46), so easing the start
	// gives that sweep room to read instead of firing off immediately.
	let q = $derived(
		cubicInOut(clamp((morph.current - morphStart) / (MORPH_END - morphStart)))
	);

	// ── Step 4 (`z`) and step 5 (`s`) ───────────────────────────────────────────
	// Neither is tweened. `q` borrows the reveal's Tween so the two share one
	// smoothing knob, but both of these are already eased below and a second
	// clock buys nothing — the morph's own tween is set to 0ms in practice.
	const ZOOM_STEP = 3;
	const STACK_STEP = 4;
	let zoomTarget = $derived(progressIn(ZOOM_STEP));
	let stackTarget = $derived(progressIn(STACK_STEP));
	// The U.S. leaves on the RAW step progress, before the zoom's window opens.
	let usFade = $derived(1 - clamp(zoomTarget / US_EXIT_SPAN));
	// cubicInOut for the same reason the morph uses it: the axis is a scale, and a
	// linear ramp into and out of a 4.4× zoom reads as a jerk at both ends.
	let z = $derived(
		cubicInOut(clamp((zoomTarget - zoomStart) / (ZOOM_END - zoomStart)))
	);
	let s = $derived(
		clamp((stackTarget - stackStart) / (STACK_END - stackStart))
	);
	// Bottom band first. Each band's own 0→1; `bandFade(0)` is Australia.
	const bandFade = (i: number) =>
		clamp((s - i * BAND_STAGGER) / BAND_FADE_SPAN);
	// Cheapest possible gate: below this the stack marks don't mount at all, so
	// the zoom step never pays to lay out four areas it can't see.
	let stackVisible = $derived(s > 0.001);

	// Chart decoration (axes, labels, grid) stays hidden until the reveal reaches
	// `FADE_START` — letting the lines grow a little first — then fades in, fully
	// on by `FADE_END`. Both are 0→1 fractions of the reveal.
	const FADE_START = 0.15;
	const FADE_END = 0.3;
	let decorationFade = $derived(
		clamp((p - FADE_START) / (FADE_END - FADE_START))
	);

	// End-of-animation ramp: drives the top (1.0) gridline/number, which fades in
	// over the last TAIL_SPAN of the reveal.
	let endFade = $derived(clamp((p - (1 - TAIL_SPAN)) / TAIL_SPAN));

	// Dots pop-in: a self-contained tween on its OWN clock (DOT_ANIM_MS), fired once
	// the reveal passes DOT_TRIGGER. We grow the actual RADIUS (not a CSS scale):
	// SveltePlot recomputes each symbol path centred at (0,0) and leaves the
	// translate(x,y) untouched, so every dot grows about its own data point. (A CSS
	// `scale` drifts from the top-left because SveltePlot's translate lives in the
	// transform attribute, which composes outside an individual `scale`.) Only the
	// two dot marks re-render per frame, so it stays cheap.
	const dotGrow = Tween.of(() => (SHOW_DOTS && p >= DOT_TRIGGER ? 1 : 0), {
		duration: DOT_ANIM_MS,
		easing: cubicOut
	});

	// ── 2016 crossover annotation ───────────────────────────────────────────────
	// Where the callout points: 2014, the year the two series sit closest together
	// (US 4.44, Australia 4.49 per million — 1.2% apart, the tightest pair on the
	// chart). Kept in chart coordinates so the callout + leader stay anchored on
	// resize. The VALUE is a fact about the data, not a placement, so read it off
	// the series instead of hardcoding it in whatever unit happened to be current
	// (it used to be a bare 0.412, only meaningful on the old /100k axis). With the
	// two series that close, their mean is the midpoint between the year's dots —
	// which is what the ring below is centred on.
	const CROSS_YEAR = 2014;
	const rateAt = (year: number, key: "usRate" | "auRate") => {
		const i = data.findIndex((d) => d.year >= year);
		if (i <= 0) return data[Math.max(i, 0)][key];
		const a = data[i - 1];
		const b = data[i];
		return a[key] + ((year - a.year) / (b.year - a.year)) * (b[key] - a[key]);
	};
	const CROSS = {
		year: CROSS_YEAR,
		value: (rateAt(CROSS_YEAR, "usRate") + rateAt(CROSS_YEAR, "auRate")) / 2
	};
	// The callout marker is a RING, not a filled dot: it encircles the year's two
	// data dots rather than sitting on top of them, so once the dots grow in at the
	// end of the reveal both are still readable inside it.
	//
	// Radius is in px, so it has to clear the worst case — the widest plot, where
	// the two 2014 values are furthest apart. That gap is 0.051 of a 14-unit axis,
	// ~2.4px on a 650px-tall plot, so each dot's centre sits ~1.2px off the ring
	// centre and needs DOT_R (3) more to fit its edge. 9 leaves ~4.5px of clear
	// space around the pair; drop it and the dots start touching the stroke.
	const CROSS_RING_R = 9;
	// Callout text position, per breakpoint. Heights are FRACTIONS OF THE AXIS —
	// these are arbitrary placements, so pinning them to the domain keeps them put
	// through a unit change.
	//   Desktop — lower-RIGHT of the dot, in the wedge under the crossing lines.
	//   Mobile   — upper-LEFT instead: the mobile lead note rests as a bottom card
	//     (see `.lead-note` in the @media block), which lands on top of a
	//     lower-right callout. The 2000–2015 × upper-half quadrant is empty on both
	//     series (the U.S. peaks at ~47% of the axis, Australia stays under 35%
	//     until 2016), so the text AND its leader clear the data.
	const CROSS_LABEL_DESKTOP = { year: 2019, value: 0.2 * Y_MAX };
	const CROSS_LABEL_MOBILE = { year: 2007.5, value: 0.56 * Y_MAX };
	let crossLabel = $derived(
		isMobile ? CROSS_LABEL_MOBILE : CROSS_LABEL_DESKTOP
	);
	const CROSS_REVEAL = (CROSS.year - X0) / (X1 - X0); // ≈ 0.56
	// Shared fade duration for ALL annotation text (intro, lead note, callout).
	const CROSS_FADE_SPAN = 0.04;
	// Leader line endpoints — symmetric gap from the text and the dot. LEADER_GAP
	// (fraction of the text→dot span, applied to both ends) is the tuning knob.
	// Derived, not constant, so the leader follows the label across the breakpoint.
	const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
	const LEADER_GAP = 0.95;
	let leaderA = $derived({
		year: lerp(crossLabel.year, CROSS.year, LEADER_GAP),
		value: lerp(crossLabel.value, CROSS.value, LEADER_GAP)
	}); // near the dot
	let leaderB = $derived({
		year: lerp(crossLabel.year, CROSS.year, 1 - LEADER_GAP),
		value: lerp(crossLabel.value, CROSS.value, 1 - LEADER_GAP)
	}); // near the text

	// The callout fades in at the crossover over CROSS_FADE_SPAN.
	let crossFade = $derived(clamp((p - CROSS_REVEAL) / CROSS_FADE_SPAN));

	// Prose-note handoff at the crossover: a SCROLL transition (not a fade-in-place).
	// The intro note scrolls up and out; the lead note scrolls up into place. Both
	// driven by `p` so they stay pinned to the crossover.
	//
	// MOTION is locked to the scroll at 1:1 — a note travels one pixel per pixel
	// the reader scrolls, exactly like a real paragraph (or a visible ScrolloStep,
	// which is just normal-flow content under the sticky chart). Anything else
	// reads as "fast": a fixed p-fraction window with a fixed px travel makes the
	// rate an accident of viewport height. Scrollo's stepProgress is
	// `(triggerLine - elementTop) / rect.height`, so ONE unit of `p` == the
	// animation step's height in scroll px — measure that (`stepPx`) and a px
	// travel converts straight into the p-span that scrolls it 1:1.
	// ONE treatment at both breakpoints: the intro scrolls all the way out of the
	// top of the frame, the lead rises LEAD_SHIFT into place, both at 1:1.
	//
	// Desktop used to do this in a 48px flick. That was the same *rate* — but over
	// so little distance that the whole handoff was spent in 48px of scroll, while
	// mobile's took ~235px. Distance is what sets the duration here, so matching
	// mobile's distances is what matches its pace; stretching a 48px move over
	// 235px of scroll would have put desktop back at ~0.2× and undone the 1:1 fix.
	const LEAD_SHIFT = 150;
	const NOTE_SHIFT_FALLBACK = 48; // used only until the intro note is measured
	// A 1:1 move costs its distance in scroll, and only (1 − CROSS_REVEAL) of the
	// step is left after the crossover. Cap any travel so it always completes by
	// ARRIVE_BY instead of freezing part-way on a short viewport.
	// 0.98, not 0.95: the intro's full exit is ~235px on a 780px-tall phone and a
	// 0.95 cap allowed only 226, leaving a few px of card to fade at the frame edge
	// instead of scrolling cleanly out. The reveal still finishes after both notes.
	const ARRIVE_BY = 0.98;
	// The same two rules govern every note, so they're written once and applied per
	// step. `capOf` was previously spelled three different ways (here, note3Travel,
	// leadExitTravel) and `spanOf` twice, with the `> 0` fallback repeated at all
	// five sites — a change to ARRIVE_BY's meaning had to be made in three shapes.
	const capOf = (px: number, distance: number, start: number) =>
		px > 0 ? Math.min(distance, (ARRIVE_BY - start) * px) : distance;
	const spanOf = (px: number, distance: number) =>
		px > 0 ? distance / px : SPAN_FALLBACK;
	// Scroll position at a given fraction through a step — the inverse of Scrollo's
	// stepProgress. See the note on handoffScrollY below.
	const scrollYAt = (top: number, px: number, frac: number) =>
		top + frac * px - triggerPx;

	const capTravel = (px: number) => capOf(stepPx, px, CROSS_REVEAL);
	// `introExitPx` is measured (below) as the distance that carries the whole note
	// past the top of the frame, where .layout-container's overflow:hidden removes
	// it — the same way a real paragraph leaves the screen.
	let introTravel = $derived(
		capTravel(introExitPx > 0 ? introExitPx : NOTE_SHIFT_FALLBACK)
	);
	let leadTravel = $derived(capTravel(LEAD_SHIFT));
	// px → p-span. Before the step is measured, fall back to a span that keeps the
	// old behaviour rather than dividing by zero.
	const SPAN_FALLBACK = 0.08;
	const toSpan = (px: number) => spanOf(stepPx, px);
	// The intro starts leaving BEFORE the crossover, not at it. The notes form a
	// conveyor — each rises from below, holds, then rises out of the top — and if
	// note 1 only began leaving at the takeover, note 2 would be arriving into an
	// occupied frame. Giving note 1 a head start means that by the time the
	// takeover lands, note 2 is appearing into space note 1 has already vacated,
	// and each note gets roughly equal screen time.
	const INTRO_EXIT_LEAD = 0.09; // in units of `p`, ahead of CROSS_REVEAL
	let introExitStart = $derived(CROSS_REVEAL - INTRO_EXIT_LEAD);
	let introTravelled = $derived(
		clamp((p - introExitStart) / toSpan(introTravel))
	);
	let leadTravelled = $derived(clamp((p - CROSS_REVEAL) / toSpan(leadTravel)));
	// OPACITY is deliberately NOT tied to the travel: a paragraph scrolling through
	// frame doesn't slowly materialise (or dissolve) over its whole journey. The
	// intro stays fully opaque and simply scrolls off the top — clipping does the
	// removing. Its trailing fade over the last INTRO_EXIT_FADE of the travel is a
	// safety net for the capped case, and normally lands once the note is already
	// past the frame edge. The lead just fades up over the short shared span.
	const INTRO_EXIT_FADE = 0.1;
	let introOpacity = $derived(
		1 - clamp((introTravelled - (1 - INTRO_EXIT_FADE)) / INTRO_EXIT_FADE)
	);
	// The lead note's arrival fade. Its desktop EXIT fade is applied further down
	// (it depends on step 3, which isn't derived yet at this point).
	let leadArrival = $derived(clamp((p - CROSS_REVEAL) / CROSS_FADE_SPAN));
	let introShift = $derived(-introTravelled * introTravel); // up and out

	// ── Lead-note "keep scrolling" mode (mobile) ────────────────────────────────
	// Desktop parks the lead note at its resting spot once it arrives. Mobile lets
	// it carry straight on past that spot and out of the top of the frame, like
	// body copy that simply scrolls by — clipping removes it, nothing pins it.
	//
	// This one can't run off `p`. `p` stops advancing the moment the reveal
	// completes, which happens only ~45px of scroll after the note lands, so a
	// p-driven version would inch past its mark and then freeze mid-frame — worse
	// than parking cleanly. So the travel is measured from raw scrollY instead,
	// anchored to the scroll position of the crossover: invert Scrollo's
	// stepProgress formula — progress = (scrollY + trigger − stepTop) / stepPx —
	// for progress == CROSS_REVEAL. Still 1:1, still pinned to the crossover, but
	// it keeps going for as long as the reader keeps scrolling.
	let handoffScrollY = $derived(scrollYAt(stepTopPx, stepPx, CROSS_REVEAL));
	let scrolledSinceHandoff = $derived(Math.max(0, scrollY - handoffScrollY));

	// ── Step 3's note ("raw numbers") ───────────────────────────────────────────
	// Desktop PARKS it and then pushes it out when step 4 begins (see
	// note3ExitTravel); mobile lets it keep scrolling, the same conveyor as note 2.
	//
	// Measured with the shared observeStep/measureStep helpers above; the intro
	// note keeps its own effect because it observes a bound element and measures a
	// different quantity.
	// NOTE3_START_* / note3Start live up in the config block — the morph window is
	// keyed to them, so they have to be declared before it reads them.
	// Same distance as note 2's rise.
	const NOTE3_SHIFT = LEAD_SHIFT;
	let morphStepPx = $state(0);
	// Step 3's absolute document top — needed only for the mobile keep-scrolling
	// mode below, which is driven by raw scrollY rather than by step progress.
	let morphStepTopPx = $state(0);

	const setMorphStep = (h: number, top: number) => {
		morphStepPx = h;
		morphStepTopPx = top;
	};

	$effect(() => observeStep(MORPH_STEP, setMorphStep));
	$effect(() => {
		void winH;
		void width;
		measureStep(MORPH_STEP, setMorphStep);
	});

	const morphSpan = (px: number) => spanOf(morphStepPx, px);
	let note3Travel = $derived(capOf(morphStepPx, NOTE3_SHIFT, note3Start));
	let note3Travelled = $derived(
		clamp((morphTarget - note3Start) / morphSpan(note3Travel))
	);
	// Mobile persists the scroll: note 3 rises in and then carries straight on up
	// and out, the same as note 2 — the conveyor never parks anything. Anchored to
	// raw scrollY for the same reason note 2 is: `morphTarget` stops advancing at
	// the end of step 3, so a progress-driven version would freeze the note mid
	// frame. Desktop still parks (it rests at top: 12%, with nothing following it).
	let note3HandoffScrollY = $derived(
		scrollYAt(morphStepTopPx, morphStepPx, note3Start)
	);
	let scrolledSinceNote3 = $derived(Math.max(0, scrollY - note3HandoffScrollY));
	// Arrival fade only here; the desktop exit fade is applied further down, once
	// step 4 (which drives it) has been derived.
	let note3Arrival = $derived(
		clamp((morphTarget - note3Start) / CROSS_FADE_SPAN)
	);

	// ── Steps 4 and 5: the zoom and stack notes ─────────────────────────────────
	// Structurally note 3 repeated twice, so the two are built with one helper each
	// rather than six more one-off deriveds. Each note rises 1:1 into place over
	// its own step, then — on desktop, where it would otherwise park forever in
	// front of the next beat — is pushed straight back out by the FOLLOWING step's
	// progress. Mobile needs no exit: its shift is unbounded and already leaving.
	//
	// The measuring effects stay one-per-step and deliberately un-parameterised:
	// `stepPx` feeds the 1:1 scroll math, and folding the observers together is
	// what caused the mobile URL-bar jank the split above exists to prevent.
	let zoomStepPx = $state(0);
	let zoomStepTopPx = $state(0);
	const setZoomStep = (h: number, top: number) => {
		zoomStepPx = h;
		zoomStepTopPx = top;
	};
	$effect(() => observeStep(ZOOM_STEP, setZoomStep));
	$effect(() => {
		void winH;
		void width;
		measureStep(ZOOM_STEP, setZoomStep);
	});

	let stackStepPx = $state(0);
	let stackStepTopPx = $state(0);
	const setStackStep = (h: number, top: number) => {
		stackStepPx = h;
		stackStepTopPx = top;
	};
	$effect(() => observeStep(STACK_STEP, setStackStep));
	$effect(() => {
		void winH;
		void width;
		measureStep(STACK_STEP, setStackStep);
	});

	// A note's rise: distance capped so it always completes by ARRIVE_BY, and the
	// remaining offset in px (travel at arrival = 0).
	const riseShift = (target: number, px: number, start: number) => {
		const travel = capOf(px, LEAD_SHIFT, start);
		const travelled = clamp((target - start) / spanOf(px, travel));
		return { travel, shift: (1 - travelled) * travel };
	};
	// A note's exit, driven by the NEXT step: the same distance the intro note
	// measured for clearing the top of the frame, and the same trailing fade the
	// lead note uses. The fade is NOT decoration — that measured distance carries
	// the note to the container's top edge, not past it, so on desktop clipping
	// alone leaves a readable line or two behind (which is exactly what it did
	// before this fade was added).
	const exit = (nextTarget: number, nextPx: number) => {
		const travel = capOf(
			nextPx,
			introExitPx > 0 ? introExitPx : NOTE_SHIFT_FALLBACK,
			0
		);
		const exited = clamp(nextTarget / spanOf(nextPx, travel));
		return {
			shift: exited * travel,
			fade: 1 - clamp((exited - (1 - INTRO_EXIT_FADE)) / INTRO_EXIT_FADE)
		};
	};

	// Note 3 keeps its own rise (it starts from `note3Start`, not `noteStart`) but
	// now gains an exit, because it is no longer the last note in the story.
	let note3Exit = $derived(exit(zoomTarget, zoomStepPx));
	let note3Shift = $derived(
		isMobile
			? note3Travel - scrolledSinceNote3 // rises in, then keeps going (negative)
			: (1 - note3Travelled) * note3Travel - note3Exit.shift
	);
	let note3Opacity = $derived(note3Arrival * (isMobile ? 1 : note3Exit.fade));

	let note4Rise = $derived(riseShift(zoomTarget, zoomStepPx, noteStart));
	let note4Exit = $derived(exit(stackTarget, stackStepPx));
	let scrolledSinceNote4 = $derived(
		Math.max(0, scrollY - scrollYAt(zoomStepTopPx, zoomStepPx, noteStart))
	);
	let note4Shift = $derived(
		isMobile
			? note4Rise.travel - scrolledSinceNote4
			: note4Rise.shift - note4Exit.shift
	);
	// Mobile keeps every note fully opaque — it leaves by scrolling, as a bottom
	// card, and never shares the frame with the next one.
	let note4Opacity = $derived(
		clamp((zoomTarget - noteStart) / CROSS_FADE_SPAN) *
			(isMobile ? 1 : note4Exit.fade)
	);

	// Note 5 is the last thing in the story, so it has no exit on either
	// breakpoint — desktop parks it, mobile carries it on out as usual.
	let note5Rise = $derived(riseShift(stackTarget, stackStepPx, noteStart));
	let scrolledSinceNote5 = $derived(
		Math.max(0, scrollY - scrollYAt(stackStepTopPx, stackStepPx, noteStart))
	);
	let note5Shift = $derived(
		isMobile ? note5Rise.travel - scrolledSinceNote5 : note5Rise.shift
	);
	let note5Opacity = $derived(
		clamp((stackTarget - noteStart) / CROSS_FADE_SPAN)
	);

	// Desktop lead note has to LEAVE now — it parks forever, and would otherwise
	// sit over the absolute chart still asserting the per-capita conclusion.
	// Mobile needs nothing: its leadShift is unbounded and already scrolling out.
	// Reuses introExitPx as the exit distance — both notes sit at top: 12% with the
	// same width and line-height, so they differ by at most a line, and the
	// trailing INTRO_EXIT_FADE absorbs any under-travel.
	let leadExitTravel = $derived(
		capOf(morphStepPx, introExitPx > 0 ? introExitPx : NOTE_SHIFT_FALLBACK, 0)
	);
	let leadExited = $derived(clamp(morphTarget / morphSpan(leadExitTravel)));

	let leadShift = $derived(
		isMobile
			? leadTravel - scrolledSinceHandoff // rises in, then keeps going (negative)
			: (1 - leadTravelled) * leadTravel - leadExited * leadExitTravel // parks, then exits
	);
	// Mobile stays fully opaque and simply rises out of the top, the same way the
	// intro note leaves — no fade. That's only safe because note 3 is a BOTTOM
	// card on mobile (see the @media block): the two notes occupy opposite ends of
	// the conveyor, so they never stack even while both are technically mounted.
	// Desktop still fades on its own travel, because there it PARKS at top: 12%
	// and note 3 arrives into the same spot.
	let leadOpacity = $derived(
		leadArrival *
			(isMobile
				? 1
				: 1 - clamp((leadExited - (1 - INTRO_EXIT_FADE)) / INTRO_EXIT_FADE))
	);

	// Reveal the series left→right: keep points up to the moving cutoff year and
	// add one interpolated point exactly at the cutoff so the line/fill grow
	// smoothly between data years rather than snapping point to point.
	// Returns PLOTTED rows only: the interpolated cutoff point has no underlying
	// counts, so usCount/auCount are dropped here by design (the tooltip reads
	// `data`, never this). The explicit type is what makes that intentional
	// rather than a hole. The populations DO carry through — the morph rescales
	// whatever is on screen, including the interpolated point — and interpolate
	// the same way, which is how the sheet's own series behaves between years.
	function clip(rows: typeof data, frac: number): PlotRow[] {
		const cx = X0 + frac * (X1 - X0);
		const out: PlotRow[] = [];
		for (const d of rows) {
			if (d.year <= cx) out.push(d);
			else break;
		}
		const next = out.length;
		if (next > 0 && next < rows.length) {
			const a = rows[next - 1];
			const b = rows[next];
			const t = (cx - a.year) / (b.year - a.year);
			out.push({
				year: cx,
				usRate: a.usRate + t * (b.usRate - a.usRate),
				auRate: a.auRate + t * (b.auRate - a.auRate),
				usPop: a.usPop + t * (b.usPop - a.usPop),
				auPop: a.auPop + t * (b.auPop - a.auPop)
			});
		}
		return out;
	}

	let visible = $derived(clip(data, p));
	// Need ≥2 *distinct* x values before drawing lines/areas — a single collapsed
	// x (p≈0) gives SveltePlot a zero-width domain and NaN geometry.
	let hasSpan = $derived(
		visible.length > 1 && visible[visible.length - 1].year > visible[0].year
	);

	// ── The morph: per-capita → absolute counts ─────────────────────────────────
	// A pure per-ROW LINEAR RESCALE, so there is no second dataset and no domain
	// animation. count = rate × (pop/PER), and one count unit is
	// (Y_MAX / Y_MAX_COUNT) axis units, so the transition collapses to a single
	// multiplier per point — `gain` below.
	//
	// Per ROW, not per series: the populations are per year, so the multiplier
	// grows along the x-axis (US 2.25 in 2000 → 2.78 in 2025; AU 0.153 → 0.216).
	// Every property of the one-scalar version survives — it is still a pure
	// linear rescale of each value, applied independently, with no dependence on
	// anything off-row.
	//
	// The <Plot> y-domain stays [0, Y_MAX] throughout. SveltePlot short-circuits
	// data extent when given an explicit domain, so the frame, margins and
	// gridline POSITIONS are fixed by construction — only the values move.
	//
	// Step 4's zoom is the SAME trick one level up: one trial is worth more axis
	// units when the axis tops out at 400 than when it tops out at 1750, so the
	// zoom is just that constant becoming a variable. Still no domain animation,
	// still no second dataset — which is also why the count gridlines have to be
	// positioned through it rather than precomputed.
	//
	// Lerped as axis-units-per-count rather than as the count maximum: this way
	// the drawn values grow at a constant rate through the zoom. Lerping 1750→400
	// instead would ease itself, and fight the cubicInOut already on `z`.
	const AXIS_PER_COUNT = Y_MAX / Y_MAX_COUNT;
	const AXIS_PER_COUNT_AU = Y_MAX / Y_MAX_COUNT_AU;
	let axisPerCount = $derived(lerp(AXIS_PER_COUNT, AXIS_PER_COUNT_AU, z));
	const gain = (pop: number) => (pop / PER) * axisPerCount;
	const morphed = (rate: number, pop: number, u: number) =>
		rate * lerp(1, gain(pop), u);
	// Field names stay usRate/auRate so not a single mark binding changes — only
	// which array they read. At q === 0 this returns `visible` ITSELF, so the
	// whole reveal phase allocates nothing extra and re-renders exactly as before.
	let plotRows = $derived(
		q === 0
			? visible
			: visible.map((d) => ({
					...d,
					usRate: morphed(d.usRate, d.usPop, q),
					auRate: morphed(d.auRate, d.auPop, q)
				}))
	);
	let plotHead = $derived(
		plotRows.length ? plotRows[plotRows.length - 1] : null
	);

	// ── The sponsor stack (step 5) ──────────────────────────────────────────────
	// One row list per band, in axis units. Split by sponsor once at module level
	// (the shape never changes) and only converted to axis units while the stack
	// is actually on screen — by then the zoom has finished, so `axisPerCount` is
	// constant and this recomputes once rather than every frame.
	const bandSeries = SPONSORS.map((sponsor) =>
		bands.filter((b) => b.sponsor === sponsor)
	);
	let bandRows = $derived(
		stackVisible
			? bandSeries.map((rows) =>
					rows.map((b) => ({
						year: b.year,
						y1: b.c0 * axisPerCount,
						y2: b.c1 * axisPerCount
					}))
				)
			: []
	);

	// Direct labels sit INSIDE the bands, so the four series can be read without
	// looking away to the legend. 2022, not the 2024 peak: every band is thick
	// enough there to hold a line of text, and at the peak the longest label runs
	// off the right edge of the frame.
	const BAND_LABEL_YEAR = 2022;
	let bandLabels = $derived(
		stackVisible
			? bandSeries.map((rows, i) => {
					const b = rows.find((r) => r.year === BAND_LABEL_YEAR);
					return b
						? {
								year: b.year,
								y: ((b.c0 + b.c1) / 2) * axisPerCount,
								text: sponsorLabels[i]
							}
						: null;
				})
			: []
	);

	// The legend crossfades with the FIRST band, so the colour key is present as
	// soon as there are colours to key. The tooltip waits for the LAST one: a
	// readout for a band that hasn't appeared yet points at nothing, which is a
	// worse failure than a legend that runs slightly ahead of the chart.
	let stackKey = $derived(clamp(s / BAND_FADE_SPAN));
	// The handover: `s` at which the last band is half in. Derived from the
	// stagger rather than typed as a number, so retiming the reveal can't leave
	// the tooltip and the dots disagreeing about when the stack takes over.
	const STACK_HANDOVER =
		(SPONSORS.length - 1) * BAND_STAGGER + BAND_FADE_SPAN * 0.5;
	let stackTips = $derived(s >= STACK_HANDOVER);
	// The year dots go with the line readout they belong to. Hit-testing passes to
	// the bands at STACK_HANDOVER, so a dot still drawn after that is a target
	// that no longer answers — they fade out over exactly that run and reach zero
	// as the bands take over.
	let dotFade = $derived(1 - clamp(s / STACK_HANDOVER));

	// Largest value drawn so far → which gridlines are "needed" yet. Non-decreasing
	// because `visible` always spans from 2000 to the moving cutoff.
	//
	// Reads `visible` (rate space), NOT `plotRows` — so the morph is invisible to
	// it and the gridlines can't fade back out when the plotted values shrink. The
	// `p >= 1` short-circuit makes that explicit rather than incidental: once the
	// reveal is done every gridline is needed and stays needed.
	let maxVisible = $derived(
		p >= 1
			? Y_MAX
			: visible.reduce((m, d) => Math.max(m, d.usRate, d.auRate), 0)
	);
	const tickReveal = (t: number) =>
		clamp((maxVisible - t + TICK_LEAD) / TICK_FADE_SPAN);
	// Per-tick opacity: the normal data-driven reveal, except the top tick (1.0) —
	// which the data never reaches — fades in at the very end via endFade.
	const tickOpacity = (t: number) =>
		decorationFade * (t >= Y_MAX ? endFade : tickReveal(t));

	// Year dots (one per line per year); they grow in together at the very end,
	// radius = DOT_R * dotGrow. Static during the reveal (hence the one-shot
	// tween), but they have to ride the morph, so they follow `morphed` once q > 0.
	let yearDots = $derived(
		data.map((d) => ({
			year: d.year,
			us: morphed(d.usRate, d.usPop, q),
			au: morphed(d.auRate, d.auPop, q)
		}))
	);

	// ── Dot tooltips ────────────────────────────────────────────────────────────
	// Desktop only. Hover doesn't exist on touch, a tap would fight the scroll, and
	// the mobile prose cards already sit over the chart.
	//
	// Gated on the SAME condition that mounts the dots, so a tooltip can never fire
	// for a dot that isn't drawn.
	// Any scroll kills the tooltip. Scrolling is what drives every transition here,
	// so rather than tracking `p` and `q` separately this covers both directions and
	// both transitions with one rule — and it also stops a stale readout hanging
	// over a chart that's moving underneath it. Unmounting resets HTMLTooltip's own
	// datum, so it reappears on the next pointermove once things settle.
	const TIP_SCROLL_QUIET_MS = 150;
	let scrolling = $state(false);

	$effect(() => {
		scrollY; // dependency: any scroll at all
		scrolling = true;
		const id = setTimeout(() => (scrolling = false), TIP_SCROLL_QUIET_MS);
		return () => clearTimeout(id);
	});

	let showTips = $derived(
		!isMobile && SHOW_DOTS && dotGrow.current > 0.001 && !scrolling
	);

	// One row per (year, country). Two jobs in one array:
	//   `y`  — the MORPHED value, so hit-testing matches where the dot actually is;
	//   the rest — the TRUE rate and count, which is what gets displayed. Mid-morph
	//   the plotted value is a blend of two units and means nothing, so the numbers
	//   must never be read off it. Handy side effect: the readout stays rock-steady
	//   while the chart is moving underneath.
	// Once the U.S. line has gone (step 4) its rows go with it: the dots would be
	// off the top of the frame, so their hit targets would sit over Australian
	// data pointing at a series the reader can no longer see. Australia's rows
	// still carry the U.S. comparison, so nothing is lost from the readout.
	let lineTipRows = $derived(
		data.flatMap((d) => [
			...(usFade > 0
				? [
						{
							year: d.year,
							country: "us" as const,
							y: morphed(d.usRate, d.usPop, q),
							rate: d.usRate,
							count: d.usCount,
							otherRate: d.auRate,
							otherCount: d.auCount
						}
					]
				: []),
			{
				year: d.year,
				country: "au" as const,
				y: morphed(d.auRate, d.auPop, q),
				rate: d.auRate,
				count: d.auCount,
				otherRate: d.usRate,
				otherCount: d.usCount
			}
		])
	);

	// ── Step 5's readout: the bands hit-test themselves ─────────────────────────
	// NOT HTMLTooltip. That mark searches a quadtree with a **hardcoded 25px
	// radius** (svelteplot/marks/HTMLTooltip.svelte — there is no prop for it), so
	// on a 700px-tall stack most of every band is dead space and the reader has to
	// find the one live spot per year.
	//
	// The catch zones here TILE the plot instead: nearest year in x, containing
	// band in y — which is exactly the region the reader sees, so neighbouring
	// zones butt up against each other by construction. The readout still SNAPS to
	// the band's own anchor (year, band midpoint), the point HTMLTooltip would
	// have used, rather than trailing the pointer.
	//
	// Counts and share are the year's OWN numbers: the plotted y is a cumulative
	// edge and means nothing on its own — the same trap the morph's readout dodges.
	let bandHover = $state<{
		year: number;
		index: number;
		count: number;
		total: number;
		px: number;
		py: number;
	} | null>(null);

	// `scales` comes from Plot's overlay snippet, so this reads the chart's real
	// scales rather than re-deriving the margin/inset arithmetic behind them.
	// Ordinal or projected scales have no `invert`; bail rather than throw.
	function hoverBand(evt: PointerEvent, scales: any) {
		if (
			typeof scales?.x?.fn?.invert !== "function" ||
			typeof scales?.y?.fn?.invert !== "function"
		)
			return;
		const box = (evt.currentTarget as HTMLElement).getBoundingClientRect();
		const year = Math.round(scales.x.fn.invert(evt.clientX - box.left));
		const count = scales.y.fn.invert(evt.clientY - box.top) / axisPerCount;
		// Zero-height bands (a year with no trials from that country) can only be
		// matched exactly, and the band below always wins the shared edge first —
		// so an empty band is never hoverable.
		const band = bands.find(
			(b) => b.year === year && count >= b.c0 && count <= b.c1
		);
		bandHover = band
			? {
					year,
					index: SPONSORS.indexOf(band.sponsor),
					count: band.c1 - band.c0,
					total: bandTotal.get(year) ?? 0,
					px: scales.x.fn(year),
					py: scales.y.fn(((band.c0 + band.c1) / 2) * axisPerCount)
				}
			: null;
	}

	const COUNTRY = { us: "United States", au: "Australia" } as const;
	const fmtRate = (v: number) => v.toFixed(2);
	// Rounded to whole percent; the one-in-a-few-hundred years floor at "<1%"
	// rather than printing a 0% next to a non-zero count.
	const fmtShare = (v: number) =>
		v > 0 && v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`;
	const fmtCount = (v: number) => v.toLocaleString("en-US");
	// Explicit sign, and a real minus (U+2212) rather than a hyphen. Hovered minus
	// other, so positive always means "the country you're pointing at is ahead" —
	// which is why the two rows disagree in sign before 2016 and agree after.
	const signed = (v: number, fmt: (n: number) => string) =>
		`${v > 0 ? "+" : v < 0 ? "\u2212" : ""}${fmt(Math.abs(v))}`;
	// Chip background for a difference: the fill of whichever country is AHEAD, so
	// it reads as the same band the reader sees in the chart and the legend.
	// Deliberately only on the "vs" column — colouring the raw values too would
	// make the box a swatch board. The +/- sign already carries the same meaning,
	// so nothing here is colour-alone. Measured 8.9:1 / 8.3:1 against the ink.
	const leadFill = (diff: number, country: "us" | "au") =>
		diff === 0
			? "transparent"
			: diff > 0 === (country === "us")
				? US_FILL
				: AU_FILL;

	// ── Axis relabelling ────────────────────────────────────────────────────────
	// A V: both tick sets fade to nothing at LABEL_SWAP_AT, so the axis never
	// shows two conflicting scales at once and there is no hard pop.
	let labelFade = $derived(
		clamp(Math.abs(q - LABEL_SWAP_AT) / LABEL_FADE_SPAN)
	);
	let showCounts = $derived(q >= LABEL_SWAP_AT);
	// The same V again, one step later: the 1,750 numbers hand over to the 400
	// ones mid-zoom. Both sets are POSITIONED live either way (axisPerCount), so
	// they zoom with the data and only their labels swap — what changes here is
	// which set is legible, not where the lines are.
	let zoomLabelFade = $derived(
		clamp(Math.abs(z - ZOOM_LABEL_SWAP_AT) / ZOOM_LABEL_FADE_SPAN)
	);
	let showAuCounts = $derived(z >= ZOOM_LABEL_SWAP_AT);
	let yLabel = $derived(
		showAuCounts
			? isMobile
				? Y_LABEL_COUNT_AU_MOBILE
				: Y_LABEL_COUNT_AU
			: showCounts
				? Y_LABEL_COUNT
				: `Phase 1 trials per ${PER_LABEL} residents ↑`
	);
	// Rate ticks own the axis before the first swap, the 1,750 counts between the
	// two, Australia's 400 counts after the second.
	let rateTickFade = $derived(showCounts ? 0 : labelFade);
	let countTickFade = $derived(
		showCounts && !showAuCounts ? labelFade * zoomLabelFade : 0
	);
	let auCountTickFade = $derived(showAuCounts ? labelFade * zoomLabelFade : 0);

	// The 2016 callout is a claim about the per-capita chart, so it leaves at the
	// very top of the morph — before the crossing it annotates starts sweeping.
	let calloutFade = $derived(crossFade * (1 - clamp(q / CROSS_EXIT_SPAN)));
</script>

<!-- Read-only: drives the mobile lead note's post-arrival scroll (see leadShift). -->
<svelte:window bind:scrollY bind:innerHeight={winH} />

<!-- One number cell: plain right-aligned, chipped when a background is given.
     Deliberately NOT decimal-aligned — padding integer rows out to a shared
     decimal axis left the two rows visibly staggered, which read worse than the
     ragged-but-flush right edge. -->
{#snippet numCell(str: string, bg: string | null)}
	<span
		class="ct-tip-num"
		class:ct-tip-chip={!!bg}
		style:background={bg ?? undefined}>{str}</span
	>
{/snippet}

<!-- The series colours are published as custom properties here so the prose
     copy (.us / .au spans in the notes and the step text) can tint country names
     to match their lines WITHOUT re-typing the hex values and letting them drift
     from US_COLOR / AU_COLOR. -->
<div
	class="scrollo-story"
	class:scrollo-dark={darkMode}
	style:--us-color={US_COLOR}
	style:--au-color={AU_COLOR}
>
	<div
		id="background"
		bind:clientHeight={height}
		bind:clientWidth={width}
		style:height={`calc(100vh - ${headerH}px - ${footerH}px)`}
		style:top={`${headerH}px`}
	>
		<div class="layout-container">
			<div
				class="plot-container"
				bind:clientWidth={measuredWidth}
				bind:clientHeight={measuredHeight}
				style:--fig-w={`${chartWidth}px`}
				style:--decoration-opacity={decorationFade}
				style:--us-fill={US_FILL}
				style:--au-fill={AU_FILL}
				style:--axis-muted={AXIS_MUTED}
			>
				<!-- Legend for the two DIFFERENCE BANDS (not the lines — those carry
				     their own labels at their right-hand tips). So the swatches are
				     filled blocks in the band colours, and the wording matches what the
				     shading means rather than naming the series.
				     Absolutely positioned, so it costs the chart NO height:
				     clientWidth/clientHeight (which feed the Plot) measure the content
				     box, and out-of-flow children don't contribute to it. `top: 3px` is
				     SveltePlot's measured offset for .axis-y-title, so the legend sits on
				     the same line as the y-axis title at the
				     opposite end of the row. Fades in with the rest of the chart
				     furniture via decorationFade. -->
				<div
					class="legend"
					style:opacity={decorationFade * (1 - stackKey)}
					aria-hidden={stackKey > 0.5}
				>
					<span class="legend-item">
						<i class="swatch" style:background={US_FILL}></i>U.S. leads
					</span>
					<!-- Stays up through the morph, even though the blue BAND is gone by
					     q ≈ 0.46 (the U.S. leads every year in absolute terms). It used to
					     fade out for exactly that reason, but the tooltip's difference chips
					     reuse these two fills, so this doubles as their key — and "Australia
					     leads" is still what a blue chip means, on whichever measure the
					     reader is hovering. -->
					<span class="legend-item">
						<i class="swatch" style:background={AU_FILL}></i>Australia leads
					</span>
				</div>

				<!-- Sponsor key for steps 4–5, in the same slot so the two crossfade in
				     place rather than one shifting the other. Left in the stacking order
				     the bands are drawn in (bottom → top), which is also the order they
				     fade in, so the key can be read alongside the reveal. -->
				{#if stackKey > 0}
					<div class="legend" style:opacity={decorationFade * stackKey}>
						{#each SPONSORS as sponsor, i (sponsor)}
							<span class="legend-item">
								<i class="swatch" style:background={SPONSOR_COLORS[i]}
								></i>{sponsorLabels[i]}
							</span>
						{/each}
					</div>
				{/if}

				<!-- Render gate: wait for a real measurement before mounting Plot.
				     On the first paint the container measures 0, which makes the plot
				     body height negative and SveltePlot throw. -->
				{#if data?.length && chartHeight >= MIN_PLOT_H}
					<!-- Phase 1 trials per capita (US vs Australia), revealed
					     over time by scroll. Fixed x/y domains keep the frame steady while
					     the lines and the difference fill grow left→right. -->
					<Plot
						width={chartWidth}
						height={chartHeight}
						marginLeft={isMobile ? 40 : 50}
						marginRight={isMobile ? 60 : 80}
						x={{
							domain: [X0, X1],
							inset: 4,
							label: "",
							tickFormat: { useGrouping: false }
						}}
						y={{
							domain: [0, Y_MAX],
							grid: false,
							label: yLabel,
							ticks: Y_TICKS
						}}
					>
						<!-- Gridlines + their numbers. Two sets share one snippet: the rate
						     ticks (0–10) and the absolute-count ticks (0/250/…/1.75k), which
						     have different positions and a different label, but identical
						     geometry. Drawn as Line marks spanning the x-DOMAIN rather than
						     GridY, whose x2 comes from facetWidth and is NaN pre-measurement.
						     Each fades in as the data grows tall enough to need it. -->
						{#snippet gridRow(y: number, label: string, op: number)}
							<Line
								data={[
									{ x: X0, y },
									{ x: X1, y }
								]}
								x="x"
								y="y"
								stroke={{ value: AXIS_MUTED, scale: null }}
								strokeWidth={1}
								strokeOpacity={0.15}
								opacity={op}
							/>
							<!-- Implicit axis numbers are hidden in CSS so ours can fade in
							     lockstep with their own gridline. -->
							<Text
								data={[{ x: X0, y }]}
								x="x"
								y="y"
								text={label}
								fill={{ value: AXIS_MUTED, scale: null }}
								textAnchor="end"
								dx={-8}
								opacity={AXIS_TEXT_OP * op}
							/>
						{/snippet}
						{#each Y_TICKS as t (t)}
							{@render gridRow(t, tickLabel(t), tickOpacity(t) * rateTickFade)}
						{/each}
						<!-- Count ticks only mount once the morph starts, so the reveal phase
						     renders exactly as before. Their y runs through axisPerCount, so
						     they ride step 4's zoom out of the frame instead of sitting still
						     while the data grows past them. -->
						{#if q > 0 && countTickFade > 0}
							{#each COUNT_TICKS as ct (ct)}
								{@render gridRow(
									ct * axisPerCount,
									countLabel(ct),
									decorationFade * countTickFade
								)}
							{/each}
						{/if}
						<!-- Australia's own count ticks, on the same live positions: they
						     start the zoom compressed into the bottom fifth of the frame and
						     expand into place, which is what makes the axis read as zooming
						     rather than swapping. -->
						{#if auCountTickFade > 0}
							{#each AU_COUNT_TICKS as ct (ct)}
								{@render gridRow(
									ct * axisPerCount,
									countLabel(ct),
									decorationFade * auCountTickFade
								)}
							{/each}
						{/if}
						<!-- Invisible full-range anchor: keeps the scales and measured
						     plot width stable while the visible data is still empty/collapsed
						     (otherwise a zero-width reveal yields NaN geometry). -->
						<Line
							data={[data[0], data[data.length - 1]]}
							x="year"
							y="usRate"
							strokeOpacity={0}
						/>
						{#if hasSpan}
							<!-- Fill: warm where the US leads, cool where Australia leads.
							     positiveFill applies where y2 > y1, so y2 = US. Grows with
							     the clipped data (bonus: the fill animates as we move right).
							     NB: fillOpacity currently has NO visible effect. DifferenceY
							     renders each band as stacked clipped paths (4 .area nodes for 2
							     bands) and the painted result samples as exactly US_FILL /
							     AU_FILL — alpha 1.0 — despite the computed fill-opacity reading
							     0.32. Lighten the *_FILL constants to soften the bands; this
							     number won't do it. The legend swatches use the raw constants
							     for the same reason. -->
							<!-- The whole US-vs-Australia comparison — fill and U.S. line — is
							     gated on usFade rather than merely faded: once step 4 starts it
							     is not just invisible but WRONG (on a 400-count axis the U.S.
							     runs ~4× above the frame), and unmounting also takes its
							     per-frame cost out of the zoom. -->
							{#if usFade > 0}
								<DifferenceY
									data={plotRows}
									x="year"
									y2="usRate"
									y1="auRate"
									positiveFill="United States higher"
									negativeFill="Australia higher"
									curve={CURVE}
									opacity={usFade}
								/>
							{/if}
							<!-- Both series as lines. `scale: null` keeps the literal colours. -->
							{#if stackVisible}
								<!-- The sponsor stack. Drawn BEFORE the Australia line so the
								     line stays the envelope of the bands — which it exactly is,
								     the four counts summing to the Australian total. Each band
								     is its own mark so it can carry its own opacity for the
								     bottom-up reveal; only opacity animates, never geometry. -->
								{#each bandRows as rows, i (SPONSORS[i])}
									<AreaY
										data={rows}
										x="year"
										y1="y1"
										y2="y2"
										fill={{ value: SPONSOR_COLORS[i], scale: null }}
										stroke={{ value: "white", scale: null }}
										strokeWidth={1}
										curve={CURVE}
										opacity={bandFade(i)}
									/>
								{/each}
								<!-- Names inside the bands. White ink on a saturated fill, so the
								     text is the surface showing through rather than a fifth
								     colour; it is also why the labels need the band to have
								     arrived, hence the shared bandFade. -->
								{#each bandLabels as label, i (SPONSORS[i])}
									{#if label}
										<Text
											data={[label]}
											x="year"
											y="y"
											text="text"
											fill={{ value: "white", scale: null }}
											fontWeight={600}
											textAnchor="middle"
											opacity={bandFade(i)}
										/>
									{/if}
								{/each}
							{/if}
							<Line
								data={plotRows}
								x="year"
								y="auRate"
								stroke={{ value: AU_COLOR, scale: null }}
								strokeWidth={2.5}
								curve={CURVE}
							/>
							{#if usFade > 0}
								<Line
									data={plotRows}
									x="year"
									y="usRate"
									stroke={{ value: US_COLOR, scale: null }}
									strokeWidth={2.5}
									curve={CURVE}
									opacity={usFade}
								/>
							{/if}
							<!-- Year dots: TWO marks (one per series, all 26 points each). The
							     radius grows in place via the dotGrow tween — 26× fewer marks than
							     one-per-dot, and no top-left drift. -->
							{#if SHOW_DOTS && dotGrow.current > 0.001 && dotFade > 0}
								<Dot
									data={yearDots}
									x="year"
									y="au"
									r={DOT_R * dotGrow.current}
									fill={{ value: AU_COLOR, scale: null }}
									stroke="white"
									strokeWidth={1}
									opacity={dotFade}
								/>
								{#if usFade > 0}
									<Dot
										data={yearDots}
										x="year"
										y="us"
										r={DOT_R * dotGrow.current}
										fill={{ value: US_COLOR, scale: null }}
										stroke="white"
										strokeWidth={1}
										opacity={usFade}
									/>
								{/if}
							{/if}
						{/if}
						{#if plotHead && p > 0.015}
							<!-- Labels ride the moving head of each line, just to its right, and
							     hug the line tip: US sits just above (lineAnchor bottom), Australia
							     just below (lineAnchor top), so they stay clear of each other at the
							     crossover but read as attached to the line ends. -->
							{#if usFade > 0}
								<Text
									data={[plotHead]}
									x="year"
									y="usRate"
									text="U.S. 🇺🇸"
									fill={{ value: US_COLOR, scale: null }}
									fontWeight={600}
									textAnchor="start"
									lineAnchor="bottom"
									dx={8}
									dy={-2}
									opacity={usFade}
								/>
							{/if}
							<!-- Leaves with the arrival of the stack. By then the line is the
							     TOTAL of four Australian bands, one of which is itself labelled
							     "Australia" — two labels reading the same word for different
							     quantities. The axis title already says whose chart this is. -->
							<Text
								data={[plotHead]}
								x="year"
								y="auRate"
								text={isMobile ? "Aus. 🇦🇺" : "Australia 🇦🇺"}
								fill={{ value: AU_COLOR, scale: null }}
								fontWeight={600}
								textAnchor="start"
								lineAnchor="top"
								dx={8}
								dy={2}
								opacity={1 - stackKey}
							/>
						{/if}
						{#if calloutFade > 0}
							<!-- 2014 crossover callout. Leader line + ring + text, all in chart
							     coords so they stay anchored to the data point. Fades in quickly
							     once the reveal scrubs past 2014 (crossFade). -->
							<Line
								data={[leaderA, leaderB]}
								x="year"
								y="value"
								stroke={{ value: AXIS_MUTED, scale: null }}
								strokeWidth={1}
								opacity={calloutFade * 0.6}
							/>
							<Dot
								data={[CROSS]}
								x="year"
								y="value"
								r={CROSS_RING_R}
								fill={{ value: "none", scale: null }}
								stroke={{ value: AXIS_MUTED, scale: null }}
								strokeWidth={1.25}
								opacity={calloutFade}
							/>
							<!-- Desktop: text hangs BELOW its anchor (leader leaves upward-left).
							     Mobile: the label sits upper-left, so the text must sit ABOVE its
							     anchor — otherwise the leader would run down through the text. -->
							<Text
								data={[crossLabel]}
								x="year"
								y="value"
								text={"Australia overtakes\nthe U.S. per capita"}
								fill={{ value: AU_COLOR, scale: null }}
								fontWeight={600}
								textAnchor="middle"
								lineAnchor={isMobile ? "bottom" : "top"}
								dy={isMobile ? -6 : 6}
								opacity={calloutFade}
							/>
						{/if}
						<!-- HTMLTooltip must live in Plot's `overlay` snippet, NOT among the
						     marks. Marks render into the <svg>, where a plain <div> is never laid
						     out: its rect comes back 0x0 at the origin even though the inline
						     left/top are right, so the anchor measures 0,0 and the box lands in the
						     page corner. `overlay` renders into a real positioned div beside the svg.
						-->
						{#snippet overlay({ scales }: { scales: any })}
							{#if showTips && stackTips}
								<!-- Full-area hit layer. .plot-overlay is inset:0 on the plot body and
							     pointer-events:none, so this div's box IS the plot body's box, which
							     is the coordinate space the scales project into. -->
								<div
									class="band-hit"
									role="presentation"
									onpointermove={(e) => hoverBand(e, scales)}
									onpointerleave={() => (bandHover = null)}
								></div>
								{#if bandHover}
									<!-- Same shape as HTMLTooltip's own wrapper: a zero-size, absolutely
								     positioned anchor ON the datum, which the ring is drawn around and
								     AnchoredTooltip measures to place the box. -->
									<div
										class="band-anchor"
										style:left={`${bandHover.px}px`}
										style:top={`${bandHover.py}px`}
									>
										<i
											class="dot-grown"
											style:--dot={SPONSOR_COLORS[bandHover.index]}
										></i>
										<AnchoredTooltip
											key={bandHover}
											offset={14}
											align="center"
											target=".scrollo-story"
										>
											<!-- Two rows, not the difference chart's three columns: there is
										     no "other" series to compare against, and the share carries the
										     year's total in its own label instead of spending a row on it. -->
											<div class="ct-tip">
												<div class="ct-tip-head">
													<span class="ct-tip-year">{bandHover.year}</span>
													<span
														class="ct-tip-country"
														style:color={SPONSOR_COLORS[bandHover.index]}
													>
														{SPONSORS[bandHover.index]}
													</span>
												</div>
												<div class="ct-tip-grid ct-tip-grid-band">
													<span class="ct-tip-label">trials</span>
													{@render numCell(fmtCount(bandHover.count), null)}

													<span class="ct-tip-label"
														>share of {fmtCount(bandHover.total)}</span
													>
													{@render numCell(
														fmtShare(bandHover.count / bandHover.total),
														null
													)}
												</div>
											</div>
										</AnchoredTooltip>
									</div>
								{/if}
							{:else if showTips}
								<!-- HTMLTooltip runs its own nearest-point search and positions an
							     absolute, pointer-events:none wrapper ON the hovered datum. That
							     wrapper is doing double duty here: AnchoredTooltip measures it to
							     place the floating box, and the highlight ring is simply drawn at
							     its origin. One search, so the ring and the readout can never
							     disagree about which dot is hovered. -->
								<HTMLTooltip data={lineTipRows} x="year" y={(d) => d.y || 1e-9}>
									{#snippet children({ datum })}
										{#if datum}
											<!-- Reads as the real dot growing: same fill and white stroke
										     as the Dot marks, drawn twice the radius, centred on the same
										     point so it simply covers the 6px one beneath. -->
											<i
												class="dot-grown"
												style:--dot={datum.country === "us"
													? US_COLOR
													: AU_COLOR}
											></i>
											<!-- target: our fonts and --us/--au tokens are scoped to
										     .scrollo-story, so portaling to <body> would strip them. -->
											<AnchoredTooltip
												key={datum}
												offset={14}
												align="center"
												target=".scrollo-story"
											>
												<div class="ct-tip">
													<div class="ct-tip-head">
														<span class="ct-tip-year">{datum.year}</span>
														<span
															class="ct-tip-country"
															style:color={datum.country === "us"
																? US_COLOR
																: AU_COLOR}
														>
															{COUNTRY[datum.country]}
														</span>
													</div>
													<div class="ct-tip-grid">
														<span></span>
														<span class="ct-tip-col">value</span>
														<span class="ct-tip-col"
															>vs {COUNTRY[
																datum.country === "us" ? "au" : "us"
															]}</span
														>

														<span class="ct-tip-label">per million</span>
														{@render numCell(fmtRate(datum.rate), null)}
														{@render numCell(
															signed(datum.rate - datum.otherRate, fmtRate),
															leadFill(
																datum.rate - datum.otherRate,
																datum.country
															)
														)}

														<span class="ct-tip-label">total trials</span>
														{@render numCell(fmtCount(datum.count), null)}
														{@render numCell(
															signed(datum.count - datum.otherCount, fmtCount),
															leadFill(
																datum.count - datum.otherCount,
																datum.country
															)
														)}
													</div>
												</div>
											</AnchoredTooltip>
										{/if}
									{/snippet}
								</HTMLTooltip>
							{/if}
						{/snippet}
					</Plot>
				{/if}
			</div>

			<!-- Intro annotation: C&EN-style prose centered in the top quarter of the
			     chart. Plain HTML (not a Text mark) so it gets real serif prose,
			     wrapping and line-height. Scrolls up and out at the crossover.
			     {@html} because the copy carries its own .us/.au span markup. -->
			<p
				bind:this={introEl}
				class="intro-note"
				style:opacity={introOpacity}
				style:--note-shift={`${introShift}px`}
			>
				{@html introText}
			</p>

			<!-- "Since 2016" lead note (the 2nd step's copy). Same prose style as the
			     intro note; scrolls up into place as Australia takes the lead. -->
			<p
				class="lead-note"
				style:opacity={leadOpacity}
				style:--note-shift={`${leadShift}px`}
			>
				{@html leadText}
			</p>

			<!-- "Raw numbers" note (the 3rd step's copy). Same 1:1 rise as the lead
			     note, but parks on BOTH breakpoints — it's the last thing in the
			     story, so keep-scrolling would strand it mid-frame at max scroll.
			     Guarded on the text: the ArchieML block is named "raw", and a name
			     mismatch would otherwise render an empty white card on mobile. -->
			{#if rawText}
				<p
					class="raw-note"
					style:opacity={note3Opacity}
					style:--note-shift={`${note3Shift}px`}
				>
					{@html rawText}
				</p>
			{/if}

			<!-- "Zoom in on Australia" note (the 4th step's copy). Rises like the two
			     before it; on desktop it is pushed back out again by the 5th step,
			     because it would otherwise park in front of the stack it introduces. -->
			{#if zoomText}
				<p
					class="zoom-note"
					style:opacity={note4Opacity}
					style:--note-shift={`${note4Shift}px`}
				>
					{@html zoomText}
				</p>
			{/if}

			<!-- Sponsor-breakdown note (the 5th step's copy). The last note in the
			     story, so it has no exit: desktop parks it, mobile carries it out. -->
			{#if stackText}
				<p
					class="stack-note"
					style:opacity={note5Opacity}
					style:--note-shift={`${note5Shift}px`}
				>
					{@html stackText}
				</p>
			{/if}
		</div>
	</div>

	<!-- Scrolly text overlays the sticky chart. The negative margin pulls the
	     first step up over the chart so they share the viewport; the chart stays
	     put (sticky) while these steps scroll past and drive the animation. -->
	<div
		bind:this={overlayEl}
		class="foreground-overlay"
		class:hide-step-boxes={!SHOW_STEP_BOXES}
		style:margin-top={`calc(-1 * (100vh - ${headerH}px - ${footerH}px))`}
		style:--intro-step-pad={INTRO_STEP_PADDING}
		style:--anim-step-pad={ANIM_STEP_PADDING}
		style:--morph-step-pad={MORPH_STEP_PADDING}
		style:--zoom-step-pad={ZOOM_STEP_PADDING}
		style:--stack-step-pad={STACK_STEP_PADDING}
		style:--scrollo-container-trim={isMobile ? TAIL_TRIM_MOBILE : TAIL_TRIM}
	>
		<ScrolloSteps
			bind:step
			bind:stepProgress
			{chapters}
			top={`${SCROLLO_TOP_VH}vh`}
			smoothIntro
		/>
	</div>

	<!-- Pulls fresh copy from the gdoc on page reload; comment out to freeze. -->
	<RefreshCopy docId={DOC_ID} bind:data={copy} />
</div>

<style>
	.scrollo-story {
		color-scheme: light;
	}

	.scrollo-story.scrollo-dark {
		color-scheme: dark;
	}

	:global(body):has(.scrollo-dark) {
		background-color: black;
	}

	#background {
		position: sticky;
	}

	/* Pin SveltePlot's <figure> to the *committed* pixel width instead of letting
	   it track the container every resize frame. Combined with the debounced
	   commit in the script, this stops the plot's internal ResizeObserver from
	   ping-ponging during a live window-resize drag (which otherwise freezes the
	   page with effect_update_depth_exceeded). plot.css's responsive SVG rules
	   (`max-width: 100%; height: auto`) are also dropped here for the same reason. */
	.plot-container :global(figure.svelteplot) {
		width: var(--fig-w, 100%);
		max-width: none;
	}

	/* Chart type size, in ONE place. SveltePlot writes `font-size: 11px` INLINE on
	   every <text> it renders — its axis ticks and our own Text marks alike — so
	   a stylesheet can only win with !important; there is no prop or custom
	   property to set instead. The legend above reads the same variable, so the
	   axis furniture and the key can't drift apart. */
	.plot-container {
		--chart-font-size: 12px;
	}

	.plot-container :global(svg text) {
		font-size: var(--chart-font-size) !important;
	}

	.plot-container :global(svg) {
		width: 100%;
		height: 100%;
		max-width: none;
	}

	/* Chart decoration (axes, their titles, grid) fades in with scroll, driven by
	   --decoration-opacity (0 at the intro → 1 by FADE_END). */
	.plot-container :global(.axis-x),
	.plot-container :global(.axis-y),
	.plot-container :global(.grid-x),
	.plot-container :global(.grid-y) {
		opacity: var(--decoration-opacity, 0);
	}

	/* The axis titles (incl. the y-axis label) sit outside the axis groups and
	   SveltePlot sets its own `opacity: 0.8` on them at equal specificity, so
	   `!important` is needed for the fade to win. */
	.plot-container :global(.axis-x-title),
	.plot-container :global(.axis-y-title) {
		opacity: var(--decoration-opacity, 0) !important;
	}

	/* Mute axis ticks + labels via colour (currentColor drives tick text, tick
	   lines and the axis titles). Separate property from the fade opacity above,
	   so the two never conflict. */
	.plot-container :global(.axis-x),
	.plot-container :global(.axis-y),
	.plot-container :global(.axis-x-title),
	.plot-container :global(.axis-y-title) {
		color: var(--axis-muted, currentColor);
	}

	/* Hide the implicit y-axis tick marks AND numbers — we draw our own per-tick
	   numbers as Text marks so they can fade in with their gridlines. */
	.plot-container :global(.axis-y .tick line),
	.plot-container :global(.axis-y .tick text) {
		display: none;
	}

	/* Difference-fill colours. SveltePlot sets the area fill inline via its colour
	   scale (which ignores a custom `range`), so override with !important. Positive
	   area = where the US leads (y2 > y1). */
	.plot-container :global(.positive.difference .area) {
		fill: var(--us-fill) !important;
	}

	.plot-container :global(.negative.difference .area) {
		fill: var(--au-fill) !important;
	}

	/* C&EN-style prose annotations, centred in the top quarter of the chart. The two
	   share style AND position; they hand off with a scroll transition at the
	   crossover (translateY via --note-shift, set inline). */
	.intro-note,
	.lead-note,
	.raw-note,
	.zoom-note,
	.stack-note {
		position: absolute;
		top: 12%;
		left: 50%;
		transform: translateX(-50%) translateY(var(--note-shift, 0px));
		width: 82%;
		max-width: 600px;
		margin: 0;
		font-family: var(--font-body, Georgia, "Times New Roman", Times, serif);
		font-size: var(--18px, 1.125rem);
		line-height: 30px;
		color: #242424; /* C&EN body text */
		text-align: center;
		pointer-events: none;
	}

	/* Country names tinted to their series, matching both the chart's line-end
	   labels and the .us/.au convention already used in the step copy (same colour
	   + weight 600, so the two text systems agree).
	   MUST be :global. The note prose is injected with {@html} from copy.json, so
	   those spans are created at runtime and never receive Svelte's compile-time
	   scoping class — a plain `.us` selector silently matches nothing (and gets
	   pruned as unused). Same reason the step-copy rules below are :global. The
	   .intro-note / .lead-note prefixes still scope the effect to these two notes
	   rather than leaking the classes page-wide. */
	.intro-note :global(.us),
	.lead-note :global(.us),
	.raw-note :global(.us),
	.zoom-note :global(.us),
	.stack-note :global(.us) {
		color: var(--us-color);
		font-weight: 600;
	}

	.intro-note :global(.au),
	.lead-note :global(.au),
	.raw-note :global(.au),
	.zoom-note :global(.au),
	.stack-note :global(.au) {
		color: var(--au-color);
		font-weight: 600;
	}

	/* Mobile: an active note still rests over the chart, so give it a legible card —
	   styled to match ScrolloSteps' own mobile active-step paragraph
	   (`.step.activeStep p`), so the overlay prose and the step boxes read as one
	   system if the steps are ever switched back on.
	   Copied from there: the translucent-white card, 5px radius, soft drop shadow,
	   and the 8-direction white text-outline.
	   NOT copied: `backdrop-filter: blur(2.5px)`. Blurring the full-frame SVG
	   backdrop every resize frame hangs the page (see CLAUDE.md / context.md) —
	   that hazard is exactly why these notes stopped using it. The text-outline
	   below does the legibility work the blur was there for, which is why the
	   background can drop from 0.9 to ScrolloSteps' lighter 0.75. */
	@media (max-width: 768px) {
		.intro-note,
		.lead-note,
		.raw-note,
		.zoom-note,
		.stack-note {
			width: 88%;
			/* ScrolloSteps' MOBILE padding (`--scrollo-text-padding-mobile`), not its
			   desktop `1rem` — a tight 0.1rem top/bottom so the card hugs the prose
			   and covers as little of the chart as possible. */
			padding: 0.1rem 1rem;
			border-radius: 5px;
			background: rgba(255, 255, 255, 0.75);
			box-shadow: 1px 1px 10px rgba(0, 0, 0, 0.2);

			/* Text outline using text-shadow (lifted from ScrolloSteps). */
			--stroke-width: 2px;
			--stroke-width-n: calc(var(--stroke-width) * -1);
			text-shadow:
				var(--stroke-width-n) var(--stroke-width-n) 0 white,
				0 var(--stroke-width-n) 0 white,
				var(--stroke-width) var(--stroke-width-n) 0 white,
				var(--stroke-width) 0 0 white,
				var(--stroke-width) var(--stroke-width) 0 white,
				0 var(--stroke-width) 0 white,
				var(--stroke-width-n) var(--stroke-width) 0 white,
				var(--stroke-width-n) 0 0 white;
		}

		/* The lead note (Australia's dominance) rides up from the bottom of the frame
		   (LEAD_SHIFT) and rests as a bottom card, so the whole chart body — the blue
		   peak it describes AND the crossover callout — stays visible above it.
		   Covers only the x-axis strip, which the reader has already scrolled by.

		   Note 3 does the same, so mobile reads as one conveyor: every note enters
		   from below the frame, holds as a bottom card, then rises out of the top.
		   It also keeps the two apart — note 2 is on its way out of the TOP by the
		   time note 3 arrives at the BOTTOM — which is what lets note 2 leave by
		   scrolling rather than fading. */
		.lead-note,
		.raw-note,
		.zoom-note,
		.stack-note {
			top: auto;
			bottom: 4%;
		}
	}

	/* The hovered dot, grown. Drawn at the origin of HTMLTooltip's wrapper, which
	   sits exactly on the datum — hence the negative margins to centre it. Same
	   fill + white stroke as the Dot marks at twice the radius (DOT_R 3 → 6), so
	   it covers the real 6px dot and reads as that dot swelling rather than as a
	   separate decoration. */
	.dot-grown {
		position: absolute;
		top: 0;
		left: 0;
		width: 12px;
		height: 12px;
		margin: -6px 0 0 -6px;
		background: var(--dot);
		border: 1.5px solid white;
		border-radius: 50%;
		box-sizing: border-box;
		pointer-events: none;
	}

	/* Tooltip body. font-family/color are set explicitly rather than inherited:
	   the box is portaled out of this subtree, so it can't rely on the ambient
	   cascade (see tooltip-guide.md). Sans, not the story's serif — this is a data
	   readout, not prose. */
	:global(.ct-tip) {
		font-family: var(--plot-font, Helvetica, Arial, sans-serif);
		font-size: 12px;
		line-height: 1.35;
		color: #242424;
		background: #fff;
		border: 1px solid rgba(0, 0, 0, 0.12);
		border-radius: 5px;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.16);
		padding: 7px 9px;
		white-space: nowrap;
	}

	:global(.ct-tip-head) {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin-bottom: 5px;
	}

	:global(.ct-tip-year) {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	:global(.ct-tip-country) {
		font-weight: 600;
	}

	/* value + difference side by side, so the two framings can be compared at a
	   glance — the whole point of the third step. */
	:global(.ct-tip-grid) {
		display: grid;
		grid-template-columns: auto auto auto;
		/* Row gap has to clear the chip padding — at 2px the two chips touched and
		   read as one two-tone block. */
		gap: 5px 14px;
		align-items: baseline;
	}

	/* The band hit layer has to opt back IN to pointer events — .plot-overlay
	   turns them off for the whole overlay. */
	.band-hit {
		position: absolute;
		inset: 0;
		pointer-events: auto;
	}

	.band-anchor {
		position: absolute;
		width: 0;
		height: 0;
		pointer-events: none;
	}

	/* The stack readout has no comparison column, so it drops to label + value. */
	:global(.ct-tip-grid-band) {
		grid-template-columns: auto auto;
	}

	:global(.ct-tip-col) {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #767676;
		text-align: right;
	}

	:global(.ct-tip-label) {
		color: #565656;
	}

	:global(.ct-tip-num) {
		font-variant-numeric: tabular-nums;
		text-align: right;
		/* Shrink to content: as a stretched grid item the chip background ran the
		   full column width, trailing a long empty tail to the left of the number. */
		justify-self: end;
		white-space: nowrap;
	}

	/* Difference chips. Background carries which country is ahead (matching the
	   band + legend colours); the ink stays a text token rather than taking the
	   series colour. Padded and rounded so it reads as a chip rather than a filled
	   table cell. */
	:global(.ct-tip-chip) {
		padding: 1px 6px;
		border-radius: 3px;
	}

	/* Foreground scrolly column sits above the sticky chart. pointer-events are
	   re-enabled on the step text itself inside ScrolloSteps. */
	.foreground-overlay {
		position: relative;
		z-index: 2;
		pointer-events: none;
	}

	/* The scrolly chapters are empty (they only drive scroll — the real copy lives
	   in the .intro-note / .lead-note overlays), so hide their boxes entirely. One
	   rule kills bg + blur + shadow on every breakpoint, incl. the mobile card that
	   the desktop --scrollo-* overrides don't reach. Flip SHOW_STEP_BOXES to show. */
	.foreground-overlay.hide-step-boxes :global(.step p) {
		display: none;
	}

	/* Per-step scroll length. Each step's height IS the scroll it is scrubbed
	   against, so these three rules are pacing controls, not styling.
	   The indices mirror CHART_STEP / MORPH_STEP / ZOOM_STEP / STACK_STEP in the
	   script — keep them in sync.
	   Step 1 is listed explicitly even though it restates ScrolloSteps' default:
	   without it the intro's length lives in a file nobody editing this story
	   opens, while the rest sit here. */
	.foreground-overlay :global(.step:nth-child(1)) {
		padding-bottom: var(--intro-step-pad, 60vh);
	}

	.foreground-overlay :global(.step:nth-child(2)) {
		padding-bottom: var(--anim-step-pad, 60vh);
	}

	.foreground-overlay :global(.step:nth-child(3)) {
		padding-bottom: var(--morph-step-pad, 60vh);
	}

	.foreground-overlay :global(.step:nth-child(4)) {
		padding-bottom: var(--zoom-step-pad, 60vh);
	}

	.foreground-overlay :global(.step:nth-child(5)) {
		padding-bottom: var(--stack-step-pad, 60vh);
	}

	/* Colour the series names in the step copy to match the lines. */
	.foreground-overlay :global(.us) {
		color: var(--us-color);
		font-weight: 600;
	}

	.foreground-overlay :global(.au) {
		color: var(--au-color);
		font-weight: 600;
	}

	.layout-container {
		position: relative;
		height: 100%;
		width: 100%;
		overflow: hidden;

		/* Fallback for pre-2024 browsers (Flexbox) */
		display: flex;
		flex-direction: column;
		justify-content: center;

		/* Modern standard (block layout centering) */
		display: block;
		align-content: center;
	}

	/* Height lives here rather than in plot.css: it's a property of *this* frame
	   (a sticky full-viewport pane), not of plot containers in general. A static
	   figure would want a different rule. */
	.plot-container {
		height: 96%;
		/* Restore container side margins (plot.css uses a symmetric 92%/96%), but
		   asymmetric: the RIGHT margin is smaller because the chart's own
		   marginRight already reserves room there for the series labels. Use an
		   EXPLICIT width (not auto) — an auto width lets the pinned figure feed
		   back into the measured container size and re-triggers the resize loop.
		   width + margins sum to 100%. */
		width: 94.5%;
		margin-left: 2%;
		margin-right: 2%;
		/* Anchor for .legend. Safe next to the resize-loop rules above: position
		   doesn't change the element's own box, only its descendants' reference. */
		position: relative;
	}

	/* Series legend, top-right, on the same line as SveltePlot's y-axis title.
	   Inherits .plot-container's --plot-font, so it matches the axis typography
	   rather than the surrounding serif prose. */
	.legend {
		position: absolute;
		top: 3px; /* measured offset of .axis-y-title within .plot-container */
		right: 0;
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: var(--chart-font-size);
		line-height: 14px;
		pointer-events: none;
	}

	/* Muted like the y-axis title it shares a line with, NOT in the series colours:
	   the strong red/blue belong to the LINES, and this legend is about the bands
	   between them. The swatch carries the colour; the text stays furniture. */
	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		white-space: nowrap;
		color: var(--axis-muted, currentColor);
	}

	/* A filled block, matching the shaded band. Uses US_FILL / AU_FILL at full
	   strength because that is what the chart actually paints — sampled the
	   rendered pixels and they come back exactly #FFAFB3 / #92c5de (see the note
	   on DifferenceY's fillOpacity). */
	.swatch {
		display: inline-block;
		width: 14px;
		height: 10px;
		border-radius: 2px;
	}

	/* Mobile: near-full width for more chart room (the earlier reason for 100%). */
	@media (max-width: 768px) {
		/* Four sponsor items have to share the title's line; the desktop gap costs
		   42px of it. */
		.legend {
			gap: 10px;
		}

		.plot-container {
			width: 99%;
			margin-left: 0.5%;
			margin-right: 0.5%;
		}
	}
</style>
