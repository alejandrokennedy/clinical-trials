<script lang="ts">
	import { getContext } from "svelte";
	import StoryContainer from "./story/StoryContainer.svelte";
	import PlotStory from "./story/PlotStory.svelte";

	const copy = getContext("copy");
	const data = getContext("data");
</script>

<svelte:boundary onerror={(e) => console.error(e)}>
	<StoryContainer>
    <div>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus sagittis nisi nec tellus dictum efficitur. Proin sit amet turpis euismod, volutpat dui quis, ultrices nunc. Duis et sapien scelerisque, venenatis purus et, aliquet dolor. Suspendisse laoreet turpis tempus mauris volutpat, et semper urna accumsan. Duis posuere est sed lectus mollis tristique. Phasellus et posuere ante. Cras fermentum tortor est, et interdum massa venenatis id. Pellentesque vestibulum eu ante at condimentum. Nulla facilisi. Sed vulputate luctus dignissim. Duis quis maximus risus. Donec imperdiet condimentum tortor ac vulputate. Vivamus posuere pulvinar mauris eget faucibus.

    Donec sed massa blandit, laoreet erat eu, sagittis massa. Etiam convallis, neque a pharetra vulputate, velit massa ultrices purus, sed feugiat lectus nisl lobortis enim. Nam sit amet leo id mi elementum porttitor. Interdum et malesuada fames ac ante ipsum primis in faucibus. Pellentesque vestibulum dui sit amet sapien imperdiet, sit amet luctus tellus porttitor. Fusce ac ipsum nec est semper sodales. Suspendisse eu purus ex. Ut et fringilla ante. Fusce quis nibh bibendum, bibendum tellus aliquam, tristique ligula. Aenean dignissim ut magna ac sodales. Sed quis orci molestie, viverra tortor nec, porttitor arcu. Aliquam eu justo in nulla rhoncus scelerisque. Morbi commodo cursus justo, finibus fringilla nibh tempor sit amet. Nullam in ultricies ex, sed facilisis ante.

    Donec tempor, nunc nec aliquet tempus, diam erat aliquet libero, sed blandit tellus leo sed urna. Morbi et fermentum massa. Pellentesque dapibus sodales nulla, eu accumsan nulla lobortis nec. Duis maximus mi id dapibus dapibus. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Donec at faucibus nibh. Praesent vitae sagittis tellus. Vivamus sodales, lorem sed interdum lacinia, lacus nulla malesuada ex, vel suscipit nisi nisi sed arcu. Pellentesque sed auctor magna.
</div>
		<PlotStory {copy} />
		<!-- <Story {copy} darkMode /> -->
	</StoryContainer>
</svelte:boundary>
