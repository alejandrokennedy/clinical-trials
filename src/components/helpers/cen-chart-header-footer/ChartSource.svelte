<script lang="ts">
	// Source line beneath a chart — mirrors AEM's
	// `<div class="caption"><b>Source:</b> <a href=…>…</a>.</div>`.
	// `text` is the link label; if `href` is omitted the label renders as plain
	// text (no link). Class names are kept so AEM styles apply in production; the
	// scoped styles below mirror the live AEM computed values as a dev fallback.
	//
	// Two shapes. `text` + `href` is the single-source case. `items` is the list
	// case: each source carries its OWN url, so a chart drawing on three
	// registries links each name to the right place. That matters here — with one
	// href the whole label becomes a single link, so "UN World Population
	// Prospects" would take the reader to ClinicalTrials.gov.
	//
	// Deliberately NOT a `text` string plus a parallel list of urls: those pair by
	// position, and the moment a source name contains a comma (most institutional
	// names eventually do) the two lists silently slip out of alignment.
	let {
		text,
		href,
		title,
		items
	}: {
		text?: string;
		href?: string;
		title?: string;
		items?: { name: string; url?: string }[];
	} = $props();

	// ACS style, so the serial comma: "A", "A and B", "A, B, and C". The writer
	// supplies names only — punctuation is the component's job, or it ends up
	// inside a link label.
	const separator = (i: number, n: number) =>
		i === 0 ? "" : i === n - 1 ? (n > 2 ? ", and " : " and ") : ", ";
</script>

<div class="caption">
	<b>Source:</b>
	{#if items?.length}
		{#each items as item, i (item.name)}{separator(
				i,
				items.length
			)}{#if item.url}<a href={item.url}>{item.name}</a
				>{:else}{item.name}{/if}{/each}
	{:else if text}
		{#if href}<a {href} {title}>{text}</a>{:else}{text}{/if}
	{/if}
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
