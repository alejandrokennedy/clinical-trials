<script lang="ts">
	/**
	 * PlotStory — starting point for a SveltePlot scrollytelling chart.
	 *
	 * This is a TEMPLATE, not a component to import and configure: copy it, then
	 * replace the placeholder data and marks below. It carries the boilerplate
	 * that every plot needs regardless of what it draws (Tier 1):
	 *
	 *   - page-chrome math, so the sticky pane sits between header and footer
	 *   - container measurement feeding Plot's width/height
	 *   - the render gate that prevents SveltePlot's negative-height crash
	 *   - .plot-container styles from $styles/plot.css
	 *
	 * Hover/tooltip, animated domains and step-driven series are deliberately NOT
	 * here — see the notes for where to copy those from when a story needs them.
	 */
	import "$styles/plot.css";
	import { footerState } from "$utils/footerState.svelte";
	import { MOBILE_BREAKPOINT, FOOTER_H, headerHeight } from "$utils/chrome";
	import { Plot, DifferenceY, Line, Text, Dot } from "svelteplot";
	import ScrolloSteps from "$components/helpers/ScrolloSteps.svelte";
	import chapters from "$data/plotStorySteps.json";
	import { Tween } from "svelte/motion";
	import { cubicOut } from "svelte/easing";
	// import RefreshCopy from "$components/helpers/RefreshCopy.svelte";

	interface Props {
		copy?: any;
		darkMode?: boolean;
		/** Does this story show the scroll-progress bar? Bigger features often
		 *  drop it to reclaim vertical space. Adds PROG_BAR_H on desktop. */
		progressBar?: boolean;
	}

	let { copy, darkMode = false, progressBar = false }: Props = $props();
	// let { copy: initialCopy, darkMode = false, progressBar = false }: Props = $props();
	// let copy = $state(initialCopy);
	// const DOC_ID = "your-google-doc-id-here";

	// Below this measured height the plot body computes negative and SveltePlot
	// throws on `<rect height="-…">`. See the render gate in the markup.
	const MIN_PLOT_H = 80;

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
	// normalized to trials per 100,000 residents. Mirrors the Observable notebook
	// (cell 8): reference resident populations, then count / (pop / 1e5).
	const POP = { us: 334_900_000, au: 26_640_000 };

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

	const data = counts.map(([year, us, au]) => ({
		year,
		usPer100k: us / (POP.us / 1e5),
		auPer100k: au / (POP.au / 1e5)
	}));

	// Fixed scales so the frame stays put while the lines grow into it.
	const X0 = data[0].year;
	const X1 = data[data.length - 1].year;
	const Y_MAX = 1.0; // a touch above Australia's 2024 peak (~0.96)

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

	// ── Scroll wiring ───────────────────────────────────────────────────────────
	// ScrolloSteps reports the active step index and a 0→1 progress within it.
	let step = $state<number | null | undefined>(undefined);
	let stepProgress = $state<number | null | undefined>(undefined);

	// chapters[0] = intro (chart empty), chapters[1] = scrub through time.
	const CHART_STEP = 1;

	// Target reveal amount (0 = year 2000, 1 = year 2025) from scroll position.
	let target = $derived.by(() => {
		if (step == null || step < CHART_STEP) return 0; // before/at the intro
		if (step > CHART_STEP) return 1; // past the scrub step
		return stepProgress ?? 0; // scrubbing: follow progress
	});

	// A tween smooths scroll jitter into fluid line growth.
	const reveal = new Tween(0, { duration: 250, easing: cubicOut });
	$effect(() => {
		reveal.target = target;
	});
	let p = $derived(reveal.current);

	// Chart decoration (axes, labels, grid) stays hidden until the reveal reaches
	// `FADE_START` — letting the lines grow a little first — then fades in, fully
	// on by `FADE_END`. Both are 0→1 fractions of the reveal.
	const FADE_START = 0.15;
	const FADE_END = 0.30;
	let decorationFade = $derived(
		Math.min(1, Math.max(0, (p - FADE_START) / (FADE_END - FADE_START)))
	);

	// The intro note stays fully visible until the reveal is `NOTE_FADE_START` of
	// the way through (halfway, by default), then fades out by `NOTE_FADE_END`.
	const NOTE_FADE_START = 0.5;
	const NOTE_FADE_END = 0.8;
	let noteOpacity = $derived(
		Math.min(1, Math.max(0, (NOTE_FADE_END - p) / (NOTE_FADE_END - NOTE_FADE_START)))
	);

	// ── 2016 crossover annotation ───────────────────────────────────────────────
	// The lines cross (US = Australia per capita) between 2016 and 2017; ~2016.5.
	// Kept in chart coordinates so the callout + leader stay anchored on resize.
	const CROSS = { year: 2016.5, value: 0.412 }; // the crossover point
	const CROSS_LABEL = { year: 2011, value: 0.74 }; // where the callout text sits
	// Fade the callout in quickly once the reveal scrubs past the crossover year.
	const CROSS_REVEAL = (CROSS.year - X0) / (X1 - X0); // ≈ 0.66
	const CROSS_FADE_SPAN = 0.04; // small → quick fade-in
	let crossFade = $derived(
		Math.min(1, Math.max(0, (p - CROSS_REVEAL) / CROSS_FADE_SPAN))
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
				usPer100k: a.usPer100k + t * (b.usPer100k - a.usPer100k),
				auPer100k: a.auPer100k + t * (b.auPer100k - a.auPer100k)
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
</script>

<div class="scrollo-story" class:scrollo-dark={darkMode}>
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
				<!-- Render gate: wait for a real measurement before mounting Plot.
				     On the first paint the container measures 0, which makes the plot
				     body height negative and SveltePlot throw. -->
				{#if data?.length && chartHeight >= MIN_PLOT_H}
					<!-- Phase 1 trials per 100,000 residents (US vs Australia), revealed
					     over time by scroll. Fixed x/y domains keep the frame steady while
					     the lines and the difference fill grow left→right. -->
					<Plot
						width={chartWidth}
						height={chartHeight}
						marginLeft={isMobile ? 36 : 52}
						marginRight={isMobile ? 64 : 100}
						x={{
							domain: [X0, X1],
							inset: 4,
							label: "",
							tickFormat: { useGrouping: false }
						}}
						y={{
							domain: [0, Y_MAX],
							grid: true,
							label: "Phase 1 trials per 100,000 residents",
							// tickSpacing: 80,
							ticks: [0, 0.1, 0.2]
						}}
					>
						<!-- Invisible full-range anchor: keeps the scales and measured
						     plot width stable while the visible data is still empty/collapsed
						     (otherwise a zero-width reveal yields NaN geometry). -->
						<Line
							data={[data[0], data[data.length - 1]]}
							x="year"
							y="usPer100k"
							strokeOpacity={0}
						/>
						{#if hasSpan}
							<!-- Fill: warm where the US leads, cool where Australia leads.
							     positiveFill applies where y2 > y1, so y2 = US. Grows with
							     the clipped data (bonus: the fill animates as we move right). -->
							<DifferenceY
								data={visible}
								x="year"
								y2="usPer100k"
								y1="auPer100k"
								positiveFill="United States higher"
								negativeFill="Australia higher"
								fillOpacity={0.32}
								curve={CURVE}
							/>
							<!-- Both series as lines. `scale: null` keeps the literal colours. -->
							<Line
								data={visible}
								x="year"
								y="auPer100k"
								stroke={{ value: AU_COLOR, scale: null }}
								strokeWidth={2.5}
								curve={CURVE}
							/>
							<Line
								data={visible}
								x="year"
								y="usPer100k"
								stroke={{ value: US_COLOR, scale: null }}
								strokeWidth={2.5}
								curve={CURVE}
							/>
						{/if}
						{#if head && p > 0.015}
							<!-- Labels ride the moving head of each line, just to its right. -->
							<Text
								data={[head]}
								x="year"
								y="usPer100k"
								text={isMobile ? "United\nStates" : "United States"}
								fill={{ value: US_COLOR, scale: null }}
								fontWeight={600}
								textAnchor="start"
								lineAnchor="bottom"
								dx={8}
								dy={-6}
							/>
							<Text
								data={[head]}
								x="year"
								y="auPer100k"
								text="Australia"
								fill={{ value: AU_COLOR, scale: null }}
								fontWeight={600}
								textAnchor="start"
								dx={8}
								dy={12}
							/>
						{/if}
						{#if crossFade > 0}
							<!-- 2016 crossover callout. Leader line + dot + text, all in chart
							     coords so they stay anchored to the data point. Fades in quickly
							     once the reveal scrubs past ~2016 (crossFade). -->
							<Line
								data={[CROSS_LABEL, CROSS]}
								x="year"
								y="value"
								stroke={{ value: AXIS_MUTED, scale: null }}
								strokeWidth={1}
								opacity={crossFade * 0.6}
							/>
							<Dot
								data={[CROSS]}
								x="year"
								y="value"
								r={3.5}
								fill={{ value: AXIS_MUTED, scale: null }}
								opacity={crossFade}
							/>
							<Text
								data={[CROSS_LABEL]}
								x="year"
								y="value"
								text={"Australia overtakes\nthe U.S. per capita"}
								fill={{ value: AU_COLOR, scale: null }}
								fontWeight={600}
								textAnchor="middle"
								lineAnchor="bottom"
								dy={-6}
								opacity={crossFade}
							/>
						{/if}
					</Plot>
				{/if}
			</div>

			<!-- Intro annotation: C&EN-style prose centered in the top quarter of the
			     chart. Plain HTML (not a Text mark) so it gets real serif prose,
			     wrapping and line-height. Fades out as the chart decoration fades in. -->
			<p class="intro-note" style:opacity={noteOpacity}>
				For the first 16 years of this millennium, the U.S. completed (?) more phase 1
				trials per 100,000 residents than Australia.
			</p>
		</div>
	</div>

	<!-- Scrolly text overlays the sticky chart. The negative margin pulls the
	     first step up over the chart so they share the viewport; the chart stays
	     put (sticky) while these steps scroll past and drive the animation. -->
	<div
		class="foreground-overlay"
		style:margin-top={`calc(-1 * (100vh - ${headerH}px - ${footerH}px))`}
	>
		<ScrolloSteps bind:step bind:stepProgress {chapters} top="75vh" smoothIntro />
	</div>
	<!-- uncomment below to pull directly from gdoc on page reload -->
	<!-- <RefreshCopy docId={DOC_ID} bind:data={copy} /> -->
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

	/* Difference-fill colours. SveltePlot sets the area fill inline via its colour
	   scale (which ignores a custom `range`), so override with !important. Positive
	   area = where the US leads (y2 > y1). */
	.plot-container :global(.positive.difference .area) {
		fill: var(--us-fill) !important;
	}

	.plot-container :global(.negative.difference .area) {
		fill: var(--au-fill) !important;
	}

	/* C&EN-style prose annotation, centered in the top quarter of the chart. */
	.intro-note {
		position: absolute;
		top: 12%;
		left: 50%;
		transform: translateX(-50%);
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

	/* Foreground scrolly column sits above the sticky chart. pointer-events are
	   re-enabled on the step text itself inside ScrolloSteps. */
	.foreground-overlay {
		position: relative;
		z-index: 2;
		pointer-events: none;
	}

	/* Colour the series names in the step copy to match the lines. */
	.foreground-overlay :global(.us) {
		color: #d73027;
		font-weight: 600;
	}

	.foreground-overlay :global(.au) {
		color: #4575b4;
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
		margin-left: 4%;
		margin-right: 1.5%;
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
