<script lang="ts">
	import { getContext } from "svelte";
	import StoryContainer from "./story/StoryContainer.svelte";
	import PlotStory from "./story/PlotStory.svelte";
	import ChartFooter from "./helpers/cen-chart-header-footer/ChartFooter.svelte";

	// The footer's prose lives in the SAME Google Doc as the story copy (see
	// PlotStory's DOC_ID), under a `{footer}` block, so the writer owns the
	// methodology note without touching a component. Every key is optional and a
	// missing one skips its line — with no `{footer}` block at all, ChartFooter
	// renders nothing rather than an empty rule.
	//
	// NB: this reads the BUILD-TIME copy.json. PlotStory additionally re-fetches
	// the doc at runtime (RefreshCopy), so during development a doc edit shows up
	// in the story's notes immediately but in this footer only after `pnpm gdoc`.
	type Footer = {
		note?: string;
		// A chart with several sources wants each one linked to its own page, so
		// the preferred shape is `sources` — an ArchieML array where the name and
		// the url travel together. `source`/`sourceUrl` remain as the single-source
		// form, and as the fallback while the doc still carries the old block.
		sources?: { name: string; url?: string }[];
		source?: string;
		sourceUrl?: string;
		credit?: string;
		creditUrl?: string;
	};
	const copy = getContext<{ footer?: Footer | Footer[] }>("copy");
	const data = getContext("data");

	// Tolerate the block being written as an ArchieML ARRAY (`[footer]` … `[]`)
	// rather than an object (`{footer}` … `{}`). The two differ by one character
	// in the doc and the failure mode is silent — every key reads as undefined
	// and the whole footer just stops rendering — so take the first entry rather
	// than making the writer debug a punctuation mark.
	const raw = copy?.footer;
	const footer: Footer = (Array.isArray(raw) ? raw[0] : raw) ?? {};
</script>

<svelte:boundary onerror={(e) => console.error(e)}>
	<StoryContainer>
		<PlotStory {copy} progressBar={true} />

		<div class="chart-footer">
			<ChartFooter
				note={footer.note}
				source={footer.sources?.length
					? { items: footer.sources }
					: footer.source
						? { text: footer.source, href: footer.sourceUrl }
						: undefined}
				credit={footer.credit
					? { text: footer.credit, href: footer.creditUrl }
					: undefined}
				marginTop="1.5rem"
				marginBottom="2rem"
			/>
		</div>
	</StoryContainer>
</svelte:boundary>

<style>
	.chart-footer {
		/* 2% lines the caption's left edge up with the chart's — PlotStory pins
		   .plot-container to `width: 94.5%; margin-left: 2%` (asymmetric, because
		   the chart reserves its own right margin for the series labels). Both are
		   percentages of the same story-container width, so they agree.
		   The max-width is the real constraint: #story-container runs to 125rem,
		   about three times a comfortable measure for 16px prose. */
		width: 94.5%;
		max-width: 46rem;
		margin: 0 0 0 2%;
	}

	/* Mobile deliberately does NOT follow the chart to its 0.5% gutter. A chart
	   can run to the edge of a phone screen; a paragraph can't. */
	@media (max-width: 768px) {
		.chart-footer {
			width: 92%;
			margin-left: 4%;
		}
	}
</style>
