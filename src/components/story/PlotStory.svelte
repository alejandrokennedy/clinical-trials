<script lang="ts">
	import "$styles/plot.css";
	import { footerState } from "$utils/footerState.svelte";
	import { MOBILE_BREAKPOINT, FOOTER_H, headerHeight } from "$utils/chrome";
	import { Plot, DifferenceY, Line, Text, Dot } from "svelteplot";
	import ScrolloSteps from "$components/helpers/ScrolloSteps.svelte";
	import chapters from "$data/plotStorySteps.json";
	import { Tween } from "svelte/motion";
	import { cubicOut, cubicInOut } from "svelte/easing";
	import RefreshCopy from "$components/helpers/RefreshCopy.svelte";

	interface Props {
		copy?: any;
		darkMode?: boolean;
		progressBar?: boolean;
	}

	// let { copy, darkMode = false, progressBar = false }: Props = $props();
	let { copy: initialCopy, darkMode = false, progressBar = false }: Props = $props();
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
	// Phase 1 clinical-trial counts by start year (ClinicalTrials.gov extract),
	// normalized to trials per PER residents. Mirrors the Observable notebook
	// (cell 8): reference resident populations, then count / (pop / PER).
	const POP = { us: 334_900_000, au: 26_640_000 };

	// ── Rate unit ─────────────────────────────────────────────────────────────
	// The ONE place the denominator lives. Everything downstream is derived from
	// it — the series values, the y-domain, the gridline ticks and their fade
	// timing — so changing units is these two lines plus the axis label, not a
	// hunt through hardcoded numbers. (Was 1e5 / "100,000".)
	const PER = 1e6;
	const PER_LABEL = "million";

	// [startYear, usCount, auCount]
	const counts: [number, number, number][] = [
		[2000, 283, 6], [2001, 312, 3], [2002, 398, 6], [2003, 500, 5],
		[2004, 665, 8], [2005, 785, 32], [2006, 973, 31], [2007, 1106, 40],
		[2008, 1213, 47], [2009, 1300, 52], [2010, 1316, 68], [2011, 1345, 55],
		[2012, 1249, 59], [2013, 1310, 74], [2014, 1435, 60], [2015, 1364, 87],
		[2016, 1349, 91], [2017, 1407, 127], [2018, 1439, 126], [2019, 1472, 146],
		[2020, 1420, 198], [2021, 1578, 222], [2022, 1492, 240], [2023, 1410, 198],
		[2024, 1375, 256], [2025, 1369, 238]
	];

	// Field names are deliberately unit-NEUTRAL (`usRate`, not `usPer100k`) so a
	// change of denominator doesn't ripple through every mark in the markup.
	const data = counts.map(([year, us, au]) => ({
		year,
		usRate: us / (POP.us / PER),
		auRate: au / (POP.au / PER)
	}));

	// Fixed scales so the frame stays put while the lines grow into it.
	const X0 = data[0].year;
	const X1 = data[data.length - 1].year;

	// Round the domain up to a clean tick above the tallest series, rather than
	// hardcoding it: at /million Australia peaks at ~9.61 in 2024, so this lands
	// on 10. Y_TICK_STEP is the gridline interval.
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
	// If COUNT_PEAK ever exceeds Y_MAX_COUNT the line would run out of the top.
	const Y_MAX_COUNT = 1750;
	const COUNT_TICK_STEP = 250;
	const COUNT_PEAK = Math.max(...counts.map(([, us, au]) => Math.max(us, au)));

	// Carried in AXIS units so they drop straight into the fixed [0, Y_MAX] frame.
	// toFixed(2) not (1): at quarter steps 1250 would round to "1.3k". The unary +
	// then strips the trailing zeros again, so 1000 → "1k", 1500 → "1.5k".
	const COUNT_TICKS = Array.from(
		{ length: Math.round(Y_MAX_COUNT / COUNT_TICK_STEP) + 1 },
		(_, i) => i * COUNT_TICK_STEP
	).map((v) => ({
		y: (v / Y_MAX_COUNT) * Y_MAX,
		label: v >= 1000 ? `${+(v / 1000).toFixed(2)}k` : String(v)
	}));

	// Series colours (strong line + label colours; the fill uses the muted
	// RdYlBu scheme underneath). Passed with `scale: null` so SveltePlot uses
	// them literally instead of routing them through the colour scale.
	const US_COLOR = "#d73027"; // warm / red
	const AU_COLOR = "#4575b4"; // cool / blue

	// Difference-fill colours. SveltePlot ignores a colour-scale `range`, so these
	// are applied to the area paths via CSS custom properties (see the style block).
	// Light red to echo the US line; light blue for Australia. Tweak freely.
	const US_FILL = "#FFAFB3"; // light red / salmon
	// const US_FILL = "#f4a582"; // light red / salmon
	const AU_FILL = "#92c5de"; // light blue

	// Muted colour for axis ticks + labels (applied as `color`/currentColor).
	const AXIS_MUTED = "#4b4b4b";
	const CURVE = "catmull-rom";
	// const CURVE = "linear";

	// ── Config toggles ───────────────────────────────────────────────────────────
	// Show the ScrolloSteps text boxes (bg + shadow). Off while the steps are empty;
	// flip to true to pull the reference boxes back in.
	const SHOW_STEP_BOXES = false;
	// Scroll length of the step that drives the time-series animation (the 2nd
	// step). Longer → the reveal is spread over more scrolling.
	const ANIM_STEP_PADDING = "100vh";
	// Scroll length of the 3rd step, which morphs the chart from per-capita rates
	// to absolute counts.
	const MORPH_STEP_PADDING = "100vh";
	// When note 3 starts rising, as a fraction of step 3's progress. Mobile waits:
	// the lead note is only ~45px past its resting spot when step 3 begins and is
	// still scrolling out of the top, so note 3 holds off until it has cleared.
	const NOTE3_START_DESKTOP = 0.1;
	const NOTE3_START_MOBILE = 0.45;
	let note3Start = $derived(isMobile ? NOTE3_START_MOBILE : NOTE3_START_DESKTOP);

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
	// How fast the 2016 crossover callout leaves once the morph starts. It is a
	// claim about the PER-CAPITA chart, and the crossing it points at begins
	// sweeping right at q ≈ 0.08, so it has to be gone early.
	const CROSS_EXIT_SPAN = 0.15;
	// Axis title once the chart is showing absolute counts.
	const Y_LABEL_COUNT = "Phase 1 trials started ↑";
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

	// ── Scroll wiring ───────────────────────────────────────────────────────────
	// ScrolloSteps reports the active step index and a 0→1 progress within it.
	let step = $state<number | null | undefined>(undefined);
	let stepProgress = $state<number | null | undefined>(undefined);

	// chapters[0] = intro (chart empty), chapters[1] = scrub through time.
	const CHART_STEP = 1;

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

	$effect(() => {
		const el = overlayEl?.querySelector<HTMLElement>(
			`.step:nth-child(${CHART_STEP + 1})`
		);
		if (!el) return;
		// Re-measure when the frame changes; the step's document top can shift if
		// anything above it reflows.
		void winH;
		void width;
		const measure = () => {
			stepPx = el.offsetHeight;
			stepTopPx = window.scrollY + el.getBoundingClientRect().top;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
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
	let target = $derived.by(() => {
		if (step == null || step < CHART_STEP) return 0; // before/at the intro
		if (step > CHART_STEP) return 1; // past the scrub step
		return stepProgress ?? 0; // scrubbing: follow progress
	});

	// A tween smooths scroll jitter into fluid line growth, but it also *trails* the
	// scroll by roughly this duration — the "slight lag" in the reveal. Lower it for
	// snappier tracking, raise it for more smoothing (0 = follow the scroll exactly).
	// const ANIM_TWEEN_MS = 150;
	const ANIM_TWEEN_MS = 0;
	const reveal = new Tween(0, { duration: ANIM_TWEEN_MS, easing: cubicOut });
	$effect(() => {
		reveal.target = target;
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
	let morphTarget = $derived.by(() => {
		if (step == null || step < MORPH_STEP) return 0;
		if (step > MORPH_STEP) return 1;
		return stepProgress ?? 0;
	});
	const morph = new Tween(0, { duration: MORPH_TWEEN_MS, easing: cubicOut });
	$effect(() => {
		morph.target = morphTarget;
	});
	// cubicInOut, not linear: the whole "who leads" band reversal happens in the
	// first half of q (2017 flips at q≈0.08, 2025 at q≈0.46), so easing the start
	// gives that sweep room to read instead of firing off immediately.
	let q = $derived(
		cubicInOut(clamp((morph.current - morphStart) / (MORPH_END - morphStart)))
	);

	// Chart decoration (axes, labels, grid) stays hidden until the reveal reaches
	// `FADE_START` — letting the lines grow a little first — then fades in, fully
	// on by `FADE_END`. Both are 0→1 fractions of the reveal.
	const FADE_START = 0.15;
	const FADE_END = 0.30;
	let decorationFade = $derived(clamp((p - FADE_START) / (FADE_END - FADE_START)));

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
	const dotGrow = new Tween(0, { duration: DOT_ANIM_MS, easing: cubicOut });
	$effect(() => {
		dotGrow.target = SHOW_DOTS && p >= DOT_TRIGGER ? 1 : 0;
	});

	// ── 2016 crossover annotation ───────────────────────────────────────────────
	// The lines cross (US = Australia per capita) between 2016 and 2017; ~2016.5.
	// Kept in chart coordinates so the callout + leader stay anchored on resize.
	// The crossover VALUE is a fact about the data, not a placement, so read it off
	// the series instead of hardcoding it in whatever unit happened to be current
	// (it used to be a bare 0.412, only meaningful on the old /100k axis). The two
	// series are within ~0.5% of each other here, so their mean is the crossing.
	const CROSS_YEAR = 2016.5;
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
	let crossLabel = $derived(isMobile ? CROSS_LABEL_MOBILE : CROSS_LABEL_DESKTOP);
	const CROSS_REVEAL = (CROSS.year - X0) / (X1 - X0); // ≈ 0.66
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
	const capTravel = (px: number) =>
		stepPx > 0 ? Math.min(px, (ARRIVE_BY - CROSS_REVEAL) * stepPx) : px;
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
	const toSpan = (px: number) => (stepPx > 0 ? px / stepPx : SPAN_FALLBACK);
	// The intro starts leaving BEFORE the crossover, not at it. The notes form a
	// conveyor — each rises from below, holds, then rises out of the top — and if
	// note 1 only began leaving at the takeover, note 2 would be arriving into an
	// occupied frame. Giving note 1 a head start means that by the time the
	// takeover lands, note 2 is appearing into space note 1 has already vacated,
	// and each note gets roughly equal screen time.
	const INTRO_EXIT_LEAD = 0.09; // in units of `p`, ahead of CROSS_REVEAL
	let introExitStart = $derived(CROSS_REVEAL - INTRO_EXIT_LEAD);
	let introTravelled = $derived(clamp((p - introExitStart) / toSpan(introTravel)));
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
	let handoffScrollY = $derived(stepTopPx + CROSS_REVEAL * stepPx - triggerPx);
	let scrolledSinceHandoff = $derived(Math.max(0, scrollY - handoffScrollY));

	// ── Step 3's note ("raw numbers") ───────────────────────────────────────────
	// Note 3 PARKS on both breakpoints: it's the last thing in the story, so
	// "keep scrolling" would only strand it mid-frame at max scroll. That's why it
	// needs no handoffScrollY analogue — the single biggest simplification here.
	//
	// Its own step measurement, deliberately a separate effect rather than a
	// parameterised version of the stepPx one: that effect is load-bearing for the
	// reveal's 1:1 math and handoffScrollY, and isn't worth the regression risk.
	// NOTE3_START_* / note3Start live up in the config block — the morph window is
	// keyed to them, so they have to be declared before it reads them.
	const NOTE3_SHIFT = LEAD_SHIFT;
	let morphStepPx = $state(0);
	// Step 3's absolute document top — needed only for the mobile keep-scrolling
	// mode below, which is driven by raw scrollY rather than by step progress.
	let morphStepTopPx = $state(0);

	$effect(() => {
		const el = overlayEl?.querySelector<HTMLElement>(
			`.step:nth-child(${MORPH_STEP + 1})`
		);
		if (!el) return;
		void winH;
		void width;
		const measure = () => {
			morphStepPx = el.offsetHeight;
			morphStepTopPx = window.scrollY + el.getBoundingClientRect().top;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});

	const morphSpan = (px: number) => (morphStepPx > 0 ? px / morphStepPx : SPAN_FALLBACK);
	let note3Travel = $derived(
		morphStepPx > 0
			? Math.min(NOTE3_SHIFT, (ARRIVE_BY - note3Start) * morphStepPx)
			: NOTE3_SHIFT
	);
	let note3Travelled = $derived(
		clamp((morphTarget - note3Start) / morphSpan(note3Travel))
	);
	// Mobile persists the scroll: note 3 rises in and then carries straight on up
	// and out, the same as note 2 — the conveyor never parks anything. Anchored to
	// raw scrollY for the same reason note 2 is: `morphTarget` stops advancing at
	// the end of step 3, so a progress-driven version would freeze the note mid
	// frame. Desktop still parks (it rests at top: 12%, with nothing following it).
	let note3HandoffScrollY = $derived(
		morphStepTopPx + note3Start * morphStepPx - triggerPx
	);
	let scrolledSinceNote3 = $derived(Math.max(0, scrollY - note3HandoffScrollY));
	let note3Shift = $derived(
		isMobile
			? note3Travel - scrolledSinceNote3 // rises in, then keeps going (negative)
			: (1 - note3Travelled) * note3Travel // rises in, then parks at 0
	);
	let note3Opacity = $derived(clamp((morphTarget - note3Start) / CROSS_FADE_SPAN));

	// Desktop lead note has to LEAVE now — it parks forever, and would otherwise
	// sit over the absolute chart still asserting the per-capita conclusion.
	// Mobile needs nothing: its leadShift is unbounded and already scrolling out.
	// Reuses introExitPx as the exit distance — both notes sit at top: 12% with the
	// same width and line-height, so they differ by at most a line, and the
	// trailing INTRO_EXIT_FADE absorbs any under-travel.
	let leadExitTravel = $derived(
		morphStepPx > 0
			? Math.min(
					introExitPx > 0 ? introExitPx : NOTE_SHIFT_FALLBACK,
					ARRIVE_BY * morphStepPx
				)
			: NOTE_SHIFT_FALLBACK
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
	function clip(rows: typeof data, frac: number) {
		const cx = X0 + frac * (X1 - X0);
		const out: typeof data = [];
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
				auRate: a.auRate + t * (b.auRate - a.auRate)
			});
		}
		return out;
	}

	let visible = $derived(clip(data, p));
	let head = $derived(visible.length ? visible[visible.length - 1] : null);
	// Need ≥2 *distinct* x values before drawing lines/areas — a single collapsed
	// x (p≈0) gives SveltePlot a zero-width domain and NaN geometry.
	let hasSpan = $derived(
		visible.length > 1 && visible[visible.length - 1].year > visible[0].year
	);

	// ── The morph: per-capita → absolute counts ─────────────────────────────────
	// A pure per-series LINEAR RESCALE, so there is no second dataset and no
	// domain animation. count = rate × (POP/PER), and one count unit is
	// (Y_MAX / Y_MAX_COUNT) axis units, so the entire transition collapses to one
	// multiplier per series.
	//
	// The <Plot> y-domain stays [0, Y_MAX] throughout. SveltePlot short-circuits
	// data extent when given an explicit domain, so the frame, margins and
	// gridline POSITIONS are fixed by construction — only the values move.
	const US_GAIN = (POP.us / PER) * (Y_MAX / Y_MAX_COUNT); // ≈ 1.6745
	const AU_GAIN = (POP.au / PER) * (Y_MAX / Y_MAX_COUNT); // ≈ 0.1332
	let usK = $derived(lerp(1, US_GAIN, q));
	let auK = $derived(lerp(1, AU_GAIN, q));
	// Field names stay usRate/auRate so not a single mark binding changes — only
	// which array they read. At q === 0 this returns `visible` ITSELF, so the
	// whole reveal phase allocates nothing extra and re-renders exactly as before.
	let plotRows = $derived(
		q === 0
			? visible
			: visible.map((d) => ({
					year: d.year,
					usRate: d.usRate * usK,
					auRate: d.auRate * auK
				}))
	);
	let plotHead = $derived(plotRows.length ? plotRows[plotRows.length - 1] : null);

	// Largest value drawn so far → which gridlines are "needed" yet. Non-decreasing
	// because `visible` always spans from 2000 to the moving cutoff.
	//
	// Reads `visible` (rate space), NOT `plotRows` — so the morph is invisible to
	// it and the gridlines can't fade back out when the plotted values shrink. The
	// `p >= 1` short-circuit makes that explicit rather than incidental: once the
	// reveal is done every gridline is needed and stays needed.
	let maxVisible = $derived(
		p >= 1 ? Y_MAX : visible.reduce((m, d) => Math.max(m, d.usRate, d.auRate), 0)
	);
	const tickReveal = (t: number) =>
		Math.min(1, Math.max(0, (maxVisible - t + TICK_LEAD) / TICK_FADE_SPAN));
	// Per-tick opacity: the normal data-driven reveal, except the top tick (1.0) —
	// which the data never reaches — fades in at the very end via endFade.
	const tickOpacity = (t: number) =>
		decorationFade * (t >= Y_MAX ? endFade : tickReveal(t));

	// Year dots (one per line per year); they grow in together at the very end,
	// radius = DOT_R * dotGrow. Static during the reveal (hence the one-shot
	// tween), but they have to ride the morph, so they follow usK/auK once q > 0.
	let yearDots = $derived(
		q === 0
			? data.map((d) => ({ year: d.year, us: d.usRate, au: d.auRate }))
			: data.map((d) => ({ year: d.year, us: d.usRate * usK, au: d.auRate * auK }))
	);

	// ── Axis relabelling ────────────────────────────────────────────────────────
	// A V: both tick sets fade to nothing at LABEL_SWAP_AT, so the axis never
	// shows two conflicting scales at once and there is no hard pop.
	let labelFade = $derived(clamp(Math.abs(q - LABEL_SWAP_AT) / LABEL_FADE_SPAN));
	let showCounts = $derived(q >= LABEL_SWAP_AT);
	let yLabel = $derived(
		showCounts ? Y_LABEL_COUNT : `Phase 1 trials per ${PER_LABEL} residents ↑`
	);
	// Rate ticks own the axis before the swap, count ticks after it.
	let rateTickFade = $derived(showCounts ? 0 : labelFade);
	let countTickFade = $derived(showCounts ? labelFade : 0);

	// The 2016 callout is a claim about the per-capita chart, so it leaves at the
	// very top of the morph — before the crossing it annotates starts sweeping.
	let calloutFade = $derived(crossFade * (1 - clamp(q / CROSS_EXIT_SPAN)));
</script>

<!-- Read-only: drives the mobile lead note's post-arrival scroll (see leadShift). -->
<svelte:window bind:scrollY bind:innerHeight={winH} />

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
				<div class="legend" style:opacity={decorationFade}>
					<span class="legend-item">
						<i class="swatch" style:background={US_FILL}></i>U.S. leads
					</span>
					<!-- Fades out with the morph: by q ≈ 0.46 the blue band has been
					     erased entirely (the U.S. leads every year in absolute terms), so
					     leaving this swatch up would label a band that isn't there. -->
					<span class="legend-item" style:opacity={1 - q}>
						<i class="swatch" style:background={AU_FILL}></i>Australia leads
					</span>
				</div>

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
						<!-- Progressive gridlines: a horizontal Line per tick spanning the full
						     x-domain (so x2 comes from the x-scale, not facetWidth → no NaN).
						     Each fades in as the data grows tall enough to need it, times the
						     overall decoration fade. -->
						{#each Y_TICKS as t (t)}
							<Line
								data={[{ x: X0, y: t }, { x: X1, y: t }]}
								x="x"
								y="y"
								stroke={{ value: AXIS_MUTED, scale: null }}
								strokeWidth={1}
								strokeOpacity={0.15}
								opacity={tickOpacity(t) * rateTickFade}
							/>
							<!-- Tick number, faded in tandem with its gridline (implicit axis
							     numbers hidden via CSS). -->
							<Text
								data={[{ x: X0, y: t }]}
								x="x"
								y="y"
								text={tickLabel(t)}
								fill={{ value: AXIS_MUTED, scale: null }}
								textAnchor="end"
								dx={-8}
								opacity={AXIS_TEXT_OP * tickOpacity(t) * rateTickFade}
							/>
						{/each}
						<!-- Absolute-count gridlines. Same shape as the rate ticks above but a
						     sparser set (0/500/1k/1.5k/2k), with axis positions precomputed into
						     the fixed [0, Y_MAX] frame. Only mounted once the morph starts, so
						     the reveal phase renders exactly as before. -->
						{#if q > 0}
							{#each COUNT_TICKS as ct (ct.y)}
								<Line
									data={[{ x: X0, y: ct.y }, { x: X1, y: ct.y }]}
									x="x"
									y="y"
									stroke={{ value: AXIS_MUTED, scale: null }}
									strokeWidth={1}
									strokeOpacity={0.15}
									opacity={decorationFade * countTickFade}
								/>
								<Text
									data={[{ x: X0, y: ct.y }]}
									x="x"
									y="y"
									text={ct.label}
									fill={{ value: AXIS_MUTED, scale: null }}
									textAnchor="end"
									dx={-8}
									opacity={AXIS_TEXT_OP * decorationFade * countTickFade}
								/>
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
							<DifferenceY
								data={plotRows}
								x="year"
								y2="usRate"
								y1="auRate"
								positiveFill="United States higher"
								negativeFill="Australia higher"
								curve={CURVE}
							/>
								<!-- fillOpacity={0.32} -->
							<!-- Both series as lines. `scale: null` keeps the literal colours. -->
							<Line
								data={plotRows}
								x="year"
								y="auRate"
								stroke={{ value: AU_COLOR, scale: null }}
								strokeWidth={2.5}
								curve={CURVE}
							/>
							<Line
								data={plotRows}
								x="year"
								y="usRate"
								stroke={{ value: US_COLOR, scale: null }}
								strokeWidth={2.5}
								curve={CURVE}
							/>
							<!-- Year dots: TWO marks (one per series, all 26 points each). The
							     radius grows in place via the dotGrow tween — 26× fewer marks than
							     one-per-dot, and no top-left drift. -->
							{#if SHOW_DOTS && dotGrow.current > 0.001}
								<Dot data={yearDots} x="year" y="au" r={DOT_R * dotGrow.current} fill={{ value: AU_COLOR, scale: null }} stroke="white" strokeWidth={1} />
								<Dot data={yearDots} x="year" y="us" r={DOT_R * dotGrow.current} fill={{ value: US_COLOR, scale: null }} stroke="white" strokeWidth={1} />
							{/if}
						{/if}
						{#if head && p > 0.015}
							<!-- Labels ride the moving head of each line, just to its right, and
							     hug the line tip: US sits just above (lineAnchor bottom), Australia
							     just below (lineAnchor top), so they stay clear of each other at the
							     crossover but read as attached to the line ends. -->
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
							/>
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
							/>
						{/if}
						{#if calloutFade > 0}
							<!-- 2016 crossover callout. Leader line + dot + text, all in chart
							     coords so they stay anchored to the data point. Fades in quickly
							     once the reveal scrubs past ~2016 (crossFade). -->
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
								r={3.5}
								fill={{ value: AXIS_MUTED, scale: null }}
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
		style:--anim-step-pad={ANIM_STEP_PADDING}
		style:--morph-step-pad={MORPH_STEP_PADDING}
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


	<!-- uncomment below to pull directly from gdoc on page reload -->
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
	.raw-note {
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
	.raw-note :global(.us) {
		color: var(--us-color);
		font-weight: 600;
	}

	.intro-note :global(.au),
	.lead-note :global(.au),
	.raw-note :global(.au) {
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
		.raw-note {
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
		.raw-note {
			top: auto;
			bottom: 4%;
		}
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

	/* Elongate the step that drives the time-series animation (the 2nd step) so
	   the reveal is spread over more scrolling. Controlled by --anim-step-pad. */
	.foreground-overlay :global(.step:nth-child(2)) {
		padding-bottom: var(--anim-step-pad, 60vh);
	}

	/* Scroll length of the 3rd step, which drives the per-capita → absolute morph.
	   Needs its own rule: the selector above is a literal :nth-child(2), so without
	   this the new step would silently fall back to ScrolloSteps' 60vh default. */
	.foreground-overlay :global(.step:nth-child(3)) {
		padding-bottom: var(--morph-step-pad, 60vh);
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
		/*margin-right: 1.5%;*/
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
		font-size: 11px;
		line-height: 13px;
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
		.plot-container {
			width: 99%;
			margin-left: 0.5%;
			margin-right: 0.5%;
		}
	}
</style>
