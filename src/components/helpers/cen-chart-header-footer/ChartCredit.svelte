<script lang="ts">
	// Credit line beneath a chart — mirrors AEM's
	// `<p class="credit">Credit: …</p>`. `text` is the credited name; the
	// "Credit:" prefix is boilerplate (matching ChartSource's "Source:" prefix).
	// Scoped styles mirror the live AEM computed values as a dev fallback.
	let { text }: { text: string } = $props();
</script>

<p class="credit">Credit: <i>{text}</i></p>

<style>
	.credit {
		font-family: "Roboto Mono", monospace;
		font-size: 11px;
		font-weight: 400;
		line-height: 16px;
		color: #737373; /* rgb(115, 115, 115) */
		margin: 5px 0 16px 0px; /* top right bottom left */
	}
</style>
