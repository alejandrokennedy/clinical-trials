<script lang="ts">
	// Sub-heading / dek beneath the chart title — mirrors AEM's
	// `<div class="top-caption"><b>…</b></div>`. See ChartTitle for the
	// keep-classes + scoped-fallback rationale.
	let { text }: { text: string } = $props();
</script>

<div class="top-caption"><b>{text}</b></div>

<style>
	/* AEM overrides the <b> to a light weight and makes it a block dek. These
	   values mirror the computed styles pulled from the live AEM page. */
	.top-caption b {
		display: block;
		font-family:
			Inter, "Inter Fallback", -apple-system, system-ui, "Segoe UI", Roboto,
			"Helvetica Neue", Arial, sans-serif;
		font-size: 16px;
		font-weight: 300;
		line-height: 24px;
		color: #333;
		margin-top: 20px;
		margin-bottom: 10px;
	}
</style>
