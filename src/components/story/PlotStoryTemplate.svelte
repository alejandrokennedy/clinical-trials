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
	import { Plot, BarY } from "svelteplot";
	// import RefreshCopy from "$components/helpers/RefreshCopy.svelte";

	interface Props {
		copy?: any;
		darkMode?: boolean;
		/** Does this story show the scroll-progress bar? Bigger features often
		 *  drop it to reclaim vertical space. Adds PROG_BAR_H on desktop. */
		progressBar?: boolean;
	}

	let { copy, darkMode = false, progressBar = false }: Props = $props();
	// let { copy: initialCopy, darkMode = false }: Props = $props();
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
	let chartWidth = $state(400);
	let chartHeight = $state(400);

	// ── Placeholder ───────────────────────────────────────────────────────────
	// Replace with your own data + marks. Kept so the template renders something
	// on first `npm run dev` instead of an empty frame.
	const data = [
		{ name: "alpha", value: 4 },
		{ name: "beta", value: 7 },
		{ name: "gamma", value: 3 }
	];
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
				bind:clientWidth={chartWidth}
				bind:clientHeight={chartHeight}
			>
				<!-- Render gate: wait for a real measurement before mounting Plot.
				     On the first paint the container measures 0, which makes the plot
				     body height negative and SveltePlot throw. -->
				{#if data?.length && chartHeight >= MIN_PLOT_H}
					<Plot
						width={chartWidth}
						height={chartHeight}
						marginLeft={40}
						marginRight={12}
						grid
					>
						<BarY {data} x="name" y="value" />
					</Plot>
				{/if}
			</div>
		</div>
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
	}
</style>
