<script lang="ts">
	// Chart heading — mirrors AEM's `<h3 class="heading-line-bottom fs-6 fw-bold">`.
	// The class names are kept so AEM/Bootstrap styles apply in production; the
	// scoped styles below are an explicit fallback so it also renders correctly in
	// local Svelte dev (where those global styles don't exist) and is protected
	// against interfering project-wide resets.
	let { text }: { text: string } = $props();
</script>

<h3 class="heading-line-bottom fs-6 fw-bold">{text}</h3>

<style>
	h3 {
		font-family:
			Inter, "Inter Fallback", -apple-system, system-ui, "Segoe UI", Roboto,
			"Helvetica Neue", Arial, sans-serif;
		font-size: 1rem; /* Bootstrap .fs-6 → 16px */
		font-weight: 700; /* Bootstrap .fw-bold */
		line-height: 1.2; /* → 19.2px */
		color: var(--bs-heading-color, #242424); /* AEM body color */
		margin: 0 0 0.5rem; /* 0 top, 8px bottom */
	}

	/* .heading-line-bottom — short red rule below the heading (AEM). */
	h3::after {
		content: "";
		display: block;
		width: 30px;
		height: 4px;
		margin-top: 10px;
		margin-bottom: 20px;
		background: #eb141c;
	}
</style>
