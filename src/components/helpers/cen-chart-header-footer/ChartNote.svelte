<script lang="ts">
	// Methodology / explanatory note beneath a chart. Renders into AEM's same
	// `.caption` class as ChartSource so production styling applies, but
	// deliberately WITHOUT a bold "Note:" prefix to match it. "Source:" and
	// "Credit:" label short attributions the eye skips to; this line is the
	// sentence the reader is meant to actually read, and a label in front of it
	// only announces that it is skippable. The scoped styles below mirror the live
	// AEM computed values as a dev fallback, as the sibling components do.
	//
	// Rendered with {@html} deliberately. The text comes from the Google Doc via
	// `pnpm gdoc`, and a methodology note is the one caption line that genuinely
	// needs inline markup — registry links, the population series, an <em> here
	// and there. Same trade-off the story's prose notes already make, and the
	// same consequence: any styling of tags inside it must be `:global()`.
	let { text }: { text: string } = $props();
</script>

<div class="caption note">{@html text}</div>

<style>
	.caption {
		font-family:
			Inter,
			"Inter Fallback",
			-apple-system,
			system-ui,
			"Segoe UI",
			Roboto,
			"Helvetica Neue",
			Arial,
			sans-serif;
		font-size: 16px;
		line-height: 24px;
		color: #242424;
	}

	/* The note runs longer than the source line, so it gets a little air beneath
	   it; the source line that follows carries no top margin of its own. */
	.note {
		margin-bottom: 6px;
	}

	/* {@html} content never receives Svelte's scoping class, so anchors inside
	   the note need :global() or the rule is pruned as unused and silently stops
	   matching. Colour matches ChartSource's link. */
	.caption :global(a) {
		font-weight: 400;
		color: #046dbe; /* rgb(4, 109, 190) */
		text-decoration: none;
		transition: all 0.2s ease-in-out;
	}
</style>
