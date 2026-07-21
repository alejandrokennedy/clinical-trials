<script lang="ts">
	// Source + credit block that sits below a chart. Mirror of ChartHeader:
	// each prop is optional, and a missing prop skips its subcomponent entirely.
	import ChartSource from "./ChartSource.svelte";
	import ChartCredit from "./ChartCredit.svelte";

	let {
		source,
		credit,
		marginTop,
		marginBottom
	}: {
		source?: { text: string; href?: string; title?: string };
		credit?: string;
		marginTop?: string | number;
		marginBottom?: string | number;
	} = $props();

	// Numbers are treated as px; strings pass through (e.g. "1rem").
	const toCss = (v?: string | number) =>
		v == null ? undefined : typeof v === "number" ? `${v}px` : v;
</script>

{#if source || credit}
	<div style:margin-top={toCss(marginTop)} style:margin-bottom={toCss(marginBottom)}>
		{#if source}
			<ChartSource text={source.text} href={source.href} title={source.title} />
		{/if}

		{#if credit}
			<ChartCredit text={credit} />
		{/if}
	</div>
{/if}
