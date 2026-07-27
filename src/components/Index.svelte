<script lang="ts">
	import { getContext } from "svelte";
	import StoryContainer from "./story/StoryContainer.svelte";
	import PlotStory from "./story/PlotStory.svelte";

	const copy = getContext("copy");
	const data = getContext("data");
</script>

<svelte:boundary onerror={(e) => console.error(e)}>
	<StoryContainer>
		<PlotStory {copy} progressBar={true} />
	</StoryContainer>
</svelte:boundary>
