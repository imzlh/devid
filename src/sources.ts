import S_GG51 from './sources/gg51.ts';
import S_KPDZ from './sources/kpdz.ts';
import S_AGEFANS from './sources/agefans.ts';
import S_17C from './sources/17c.ts';
import S_HZW from './sources/hzw.ts';
import { BaseVideoSource } from "./sources/index.ts";

export const SOURCES: { new(): BaseVideoSource }[] = [
    S_HZW,
    // S_AGEFANS,
    // S_GG51,
    // S_KPDZ,
    // S_17C
];