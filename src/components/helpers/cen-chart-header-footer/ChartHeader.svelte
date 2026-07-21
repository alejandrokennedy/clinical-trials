<script lang="ts">
	// Title + dek block that sits above a chart — mirrors AEM's
	// `<div class="image-title">` wrapping the h3 title and the .top-caption dek.
	import ChartTitle from "./ChartTitle.svelte";
	import ChartCaption from "./ChartCaption.svelte";

	let {
		title,
		caption,
		marginTop,
		marginBottom
	}: {
		title?: string;
		caption?: string;
		marginTop?: string | number;
		marginBottom?: string | number;
	} = $props();

	// Numbers are treated as px; strings pass through (e.g. "1rem").
	const toCss = (v?: string | number) =>
		v == null ? undefined : typeof v === "number" ? `${v}px` : v;
</script>

{#if title || caption}
	<div
		class="image-title"
		style:margin-top={toCss(marginTop)}
		style:margin-bottom={toCss(marginBottom)}
	>
		{#if title}<ChartTitle text={title} />{/if}
		{#if caption}<ChartCaption text={caption} />{/if}
	</div>
{/if}
