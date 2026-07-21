<script lang="ts">
	// Source line beneath a chart — mirrors AEM's
	// `<div class="caption"><b>Source:</b> <a href=…>…</a>.</div>`.
	// `text` is the link label; if `href` is omitted the label renders as plain
	// text (no link). Class names are kept so AEM styles apply in production; the
	// scoped styles below mirror the live AEM computed values as a dev fallback.
	let { text, href, title }: { text: string; href?: string; title?: string } =
		$props();
</script>

<div class="caption">
	<b>Source:</b>
	{#if href}<a {href} {title}>{text}</a>{:else}{text}{/if}
</div>

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

	.caption b {
		font-weight: 700;
		color: #242424;
	}

	.caption a {
		font-weight: 400;
		color: #046dbe; /* rgb(4, 109, 190) */
		text-decoration: none;
		transition: all 0.2s ease-in-out;
	}
</style>
