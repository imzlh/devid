<script setup lang="ts">
import Artplayer from "artplayer";
import Hls from "hls.js";
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";

const props = defineProps<{
  src: string;
  title: string;
  poster?: string;
  startTime?: number;
}>();

const emit = defineEmits<{
  error: [message: string];
  progress: [time: number, duration: number];
}>();

const container = ref<HTMLDivElement | null>(null);
const player = shallowRef<Artplayer | null>(null);
let hls: Hls | null = null;

function destroyPlayer() {
  hls?.destroy();
  hls = null;
  player.value?.destroy(false);
  player.value = null;
}

function attachHls(video: HTMLVideoElement, url: string) {
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    return;
  }

  if (!Hls.isSupported()) {
    emit("error", "当前浏览器不支持 HLS 播放");
    video.src = url;
    return;
  }

  hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
  });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) {
      emit("error", data.details || "HLS 播放失败");
    }
  });
  hls.loadSource(url);
  hls.attachMedia(video);
}

function mountPlayer() {
  destroyPlayer();
  if (!container.value || !props.src) return;

  player.value = new Artplayer({
    container: container.value,
    url: props.src,
    poster: props.poster,
    autoplay: true,
    pip: true,
    fullscreen: true,
    fullscreenWeb: true,
    playbackRate: true,
    setting: true,
    hotkey: true,
    mutex: true,
    customType: {
      m3u8(video, url) {
        attachHls(video, url);
      },
    },
  });

  player.value.on("ready", () => {
    if (props.startTime && props.startTime > 0 && player.value) {
      player.value.currentTime = props.startTime;
    }
  });
  player.value.on("video:timeupdate", () => {
    const video = player.value?.video;
    if (!video) return;
    emit("progress", video.currentTime, video.duration || 0);
  });
}

watch(
  () => [props.src, props.title, props.poster, props.startTime] as const,
  () => mountPlayer(),
  { flush: "post" },
);

onMounted(mountPlayer);
onBeforeUnmount(destroyPlayer);
</script>

<template>
  <div ref="container" class="art-player"></div>
</template>
