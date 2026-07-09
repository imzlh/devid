<script setup lang="ts">
import Artplayer from "artplayer";
import Hls, { FetchLoader } from "hls.js";
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { inferMediaFormat } from "../utils/media";

const props = withDefaults(defineProps<{
  src: string;
  title: string;
  format?: "m3u8" | "h5";
  poster?: string;
  startTime?: number;
}>(), {
  format: undefined,
  poster: "",
  startTime: 0,
});

const emit = defineEmits<{
  error: [message: string];
  progress: [time: number, duration: number];
  ended: [];
}>();

const container = ref<HTMLDivElement | null>(null);
const player = shallowRef<Artplayer | null>(null);
let hls: Hls | null = null;
let initialSeekTime = 0;
let mountToken = 0;

function shouldUseHls(): boolean {
  return inferMediaFormat(props.src, props.format) === "m3u8";
}

function destroyPlayer() {
  mountToken++;
  try {
    hls?.destroy();
  } catch {
    // Third-party teardown should not break the Vue component lifecycle.
  }
  hls = null;
  try {
    player.value?.destroy();
  } catch {
    // Keep stale player teardown failures from crashing the next mount.
  }
  player.value = null;
}

function attachHls(video: HTMLVideoElement, url: string, token: number) {
  if (token !== mountToken) return;
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    return;
  }

  if (!Hls.isSupported()) {
    if (token === mountToken) emit("error", "当前浏览器不支持 HLS 播放");
    video.src = url;
    return;
  }

  try {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      loader: FetchLoader,
      fetchSetup: (context, initParams) =>
        new Request(context.url, { ...initParams, referrerPolicy: "no-referrer" }),
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (token === mountToken && data.fatal) {
        emit("error", data.details || "HLS 播放失败");
      }
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  } catch (error) {
    hls?.destroy();
    hls = null;
    if (token === mountToken) {
      emit("error", error instanceof Error ? error.message : "HLS 播放失败");
    }
  }
}

function mountPlayer() {
  destroyPlayer();
  if (!container.value || !props.src) return;

  const token = ++mountToken;
  initialSeekTime = props.startTime > 0 ? props.startTime : 0;
  const useHls = shouldUseHls();
  const poster = typeof props.poster === "string" ? props.poster : "";
  const options: ConstructorParameters<typeof Artplayer>[0] = {
    container: container.value,
    url: props.src,
    poster,
    autoplay: true,
    pip: true,
    fullscreen: true,
    fullscreenWeb: true,
    playbackRate: true,
    setting: true,
    hotkey: true,
    mutex: true,
  };
  if (useHls) {
    options.type = "m3u8";
    options.customType = {
      m3u8(video, url) {
        attachHls(video, url, token);
      },
    };
  }

  let art: Artplayer;
  try {
    art = new Artplayer(options);
  } catch (error) {
    if (token === mountToken) {
      emit("error", error instanceof Error ? error.message : "播放器初始化失败");
    }
    return;
  }
  player.value = art;

  art.on("ready", () => {
    if (token === mountToken && initialSeekTime > 0) {
      art.currentTime = initialSeekTime;
    }
  });
  art.on("video:timeupdate", () => {
    if (token !== mountToken) return;
    const video = art.video;
    if (!video) return;
    emit("progress", video.currentTime, video.duration || 0);
  });
  art.on("video:error", () => {
    if (token === mountToken) emit("error", useHls ? "HLS 播放失败" : "视频播放失败");
  });
  art.on("video:ended", () => {
    if (token === mountToken) emit("ended");
  });
}

watch(
  () => [props.src, props.title, props.format, props.poster] as const,
  () => mountPlayer(),
  { flush: "post" },
);

onMounted(mountPlayer);
onBeforeUnmount(destroyPlayer);
</script>

<template>
  <div ref="container" class="art-player"></div>
</template>
