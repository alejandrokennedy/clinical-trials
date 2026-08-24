<script lang="ts">
	// Source + credit block that sits below a chart. Mirror of ChartHeader:
	// each prop is optional, and a missing prop skips its subcomponent entirely.
	import ChartNote from "./ChartNote.svelte";
	import ChartSource from "./ChartSource.svelte";
	import ChartCredit from "./ChartCredit.svelte";

	let {
		note,
		source,
		credit,
		marginTop,
		marginBottom
	}: {
		note?: string;
		source?: {
			text?: string;
			href?: string;
			title?: string;
			items?: { name: string; url?: string }[];
		};
		credit?: { text: string; href?: string };
		marginTop?: string | number;
		marginBottom?: string | number;
	} = $props();

	// Numbers are treated as px; strings pass through (e.g. "1rem").
	const toCss = (v?: string | number) =>
		v == null ? undefined : typeof v === "number" ? `${v}px` : v;
</script>

{#if note || source || credit}
	<div
		style:margin-top={toCss(marginTop)}
		style:margin-bottom={toCss(marginBottom)}
	>
		<!-- Note first: it explains what the reader is looking at, and the source
		     line reads as the short factual sign-off before the credit. Swapping
		     the two blocks is the whole change if the desk prefers it the other
		     way round. -->
		{#if note}
			<ChartNote text={note} />
		{/if}

		{#if source}
			<ChartSource
				text={source.text}
				href={source.href}
				title={source.title}
				items={source.items}
			/>
		{/if}

		{#if credit}
			<ChartCredit text={credit.text} href={credit.href} />
		{/if}
	</div>
{/if}
