import S_GG51 from './sources/gg51.ts';
import S_KPDZ from './sources/kpdz.ts';
import S_AGEFANS from './sources/agefans.ts';
import S_17C from './sources/17c.ts';
import S_HZW from './sources/hzw.ts';
import S_AKI from './sources/aki.ts';
import S_AOWU from './sources/aowu.ts';
import S_HANIME from './sources/hanime.ts';
import S_AVBEBE from './sources/avbebe.ts';
import S_1ANIME from './sources/1anime.ts';
import { BaseVideoSource } from "./sources/index.ts";

export const SOURCES: { new(): BaseVideoSource }[] = [
    S_1ANIME,
    S_AGEFANS,
    S_AKI,
    S_AOWU,
    S_HANIME,
    S_AVBEBE,
    S_GG51,
    S_KPDZ,
    S_17C,
    S_HZW
];