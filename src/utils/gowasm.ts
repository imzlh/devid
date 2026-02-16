// deno-lint-ignore-file no-explicit-any no-unused-vars
const enosys = () => {
    const err = new Error("not implemented");
    (err as NodeJS.ErrnoException).code = "ENOSYS";
    return err;
};

const decoder = new TextDecoder("utf-8");

export default class GoVM {
    private sandboxGlobal: Record<string, any>;

    private _inst?: WebAssembly.Instance;
    private _values: any[] = [];
    private _goRefCounts: number[] = [];
    private _ids: Map<any, number> = new Map();
    private _idPool: number[] = [];
    private _logLine: number[] = [];
    private exited: boolean = false;
    private _pendingEvent?: { id: number; this: any; args: IArguments; result?: any };
    private _resolveExitPromise?: () => void;
    private _exitPromise: Promise<void>;

    constructor(global: Record<string, any> = {}) {
        this.sandboxGlobal = global;

        // Inject minimal globals for compatibility
        this.sandboxGlobal.window ??= this.sandboxGlobal;
        this.sandboxGlobal.global ??= this.sandboxGlobal;
        this.sandboxGlobal.self ??= this.sandboxGlobal;

        // Provide fallbacks if host environment lacks them
        if (!this.sandboxGlobal.crypto) {
            this.sandboxGlobal.crypto = {
                getRandomValues: crypto.getRandomValues.bind(crypto),
            };
        }
        if (!this.sandboxGlobal.performance) {
            this.sandboxGlobal.performance = performance;
        }
        if (!this.sandboxGlobal.TextEncoder) {
            this.sandboxGlobal.TextEncoder = TextEncoder;
        }
        if (!this.sandboxGlobal.TextDecoder) {
            this.sandboxGlobal.TextDecoder = TextDecoder;
        }

        if (!this.sandboxGlobal.fs) {
            let outputBuf = "";
            this.sandboxGlobal.fs = {
                constants: {
                    O_WRONLY: -1,
                    O_RDWR: -1,
                    O_CREAT: -1,
                    O_TRUNC: -1,
                    O_APPEND: -1,
                    O_EXCL: -1,
                },
                writeSync(fd: number, buf: Uint8Array): number {
                    outputBuf += decoder.decode(buf);
                    const nl = outputBuf.lastIndexOf("\n");
                    if (nl !== -1) {
                        console.log('GoVM:', fd, outputBuf.substring(0, nl));
                        outputBuf = outputBuf.substring(nl + 1);
                    }
                    return buf.length;
                },
                write(
                    fd: number,
                    buf: Uint8Array,
                    offset: number,
                    length: number,
                    position: number | null,
                    callback: (err: Error | null, n?: number) => void
                ) {
                    if (offset !== 0 || length !== buf.length || position !== null) {
                        callback(enosys());
                        return;
                    }
                    const n = this.writeSync(fd, buf);
                    callback(null, n);
                },
                // ... other stubs unchanged
                chmod: (path: string, mode: number, callback: (err: Error) => void) => callback(enosys()),
                chown: (path: string, uid: number, gid: number, callback: (err: Error) => void) => callback(enosys()),
                close: (fd: number, callback: (err: Error) => void) => callback(enosys()),
                fchmod: (fd: number, mode: number, callback: (err: Error) => void) => callback(enosys()),
                fchown: (fd: number, uid: number, gid: number, callback: (err: Error) => void) => callback(enosys()),
                fstat: (fd: number, callback: (err: Error) => void) => callback(enosys()),
                fsync: (fd: number, callback: (err: Error | null) => void) => callback(null),
                ftruncate: (fd: number, length: number, callback: (err: Error) => void) => callback(enosys()),
                lchown: (path: string, uid: number, gid: number, callback: (err: Error) => void) => callback(enosys()),
                link: (path: string, link: string, callback: (err: Error) => void) => callback(enosys()),
                lstat: (path: string, callback: (err: Error) => void) => callback(enosys()),
                mkdir: (path: string, perm: number, callback: (err: Error) => void) => callback(enosys()),
                open: (path: string, flags: number, mode: number, callback: (err: Error) => void) => callback(enosys()),
                read: (
                    fd: number,
                    buffer: Uint8Array,
                    offset: number,
                    length: number,
                    position: number,
                    callback: (err: Error) => void
                ) => callback(enosys()),
                readdir: (path: string, callback: (err: Error) => void) => callback(enosys()),
                readlink: (path: string, callback: (err: Error) => void) => callback(enosys()),
                rename: (from: string, to: string, callback: (err: Error) => void) => callback(enosys()),
                rmdir: (path: string, callback: (err: Error) => void) => callback(enosys()),
                stat: (path: string, callback: (err: Error) => void) => callback(enosys()),
                symlink: (path: string, link: string, callback: (err: Error) => void) => callback(enosys()),
                truncate: (path: string, length: number, callback: (err: Error) => void) => callback(enosys()),
                unlink: (path: string, callback: (err: Error) => void) => callback(enosys()),
                utimes: (path: string, atime: number, mtime: number, callback: (err: Error) => void) => callback(enosys()),
            };
        }

        if (!this.sandboxGlobal.process) {
            this.sandboxGlobal.process = {
                getuid: () => -1,
                getgid: () => -1,
                geteuid: () => -1,
                getegid: () => -1,
                getgroups: () => { throw enosys(); },
                pid: -1,
                ppid: -1,
                umask: () => { throw enosys(); },
                cwd: () => { throw enosys(); },
                chdir: () => { throw enosys(); },
            };
        }

        this._values = [NaN, 0, null, true, false, this.sandboxGlobal, this];
        this._goRefCounts = new Array(this._values.length).fill(0);
        this._ids = new Map();
        this._idPool = [];
        this.exited = false;
        this._exitPromise = new Promise<void>((resolve) => {
            this._resolveExitPromise = resolve;
        });
    }

    get importObject(): WebAssembly.Imports {
        const that = this;
        const mem = () => new DataView((that._inst!.exports.memory as WebAssembly.Memory).buffer);

        const setInt64 = (addr: number, v: bigint | number) => {
            mem().setUint32(addr + 0, Number(v), true);
            mem().setUint32(addr + 4, Math.floor(Number(v) / 4294967296), true);
        };

        const loadValue = (addr: number) => {
            const f = mem().getFloat64(addr, true);
            if (f === 0) return undefined;
            if (!isNaN(f)) return f;
            const id = mem().getUint32(addr, true);
            return that._values[id];
        };

        const storeValue = (addr: number, v: any) => {
            const nanHead = 0x7ff80000;
            if (typeof v === "number") {
                if (isNaN(v)) {
                    mem().setUint32(addr + 4, nanHead, true);
                    mem().setUint32(addr, 0, true);
                    return;
                }
                if (v === 0) {
                    mem().setUint32(addr + 4, nanHead, true);
                    mem().setUint32(addr, 1, true);
                    return;
                }
                mem().setFloat64(addr, v, true);
                return;
            }
            switch (v) {
                case undefined: mem().setFloat64(addr, 0, true); return;
                case null: mem().setUint32(addr + 4, nanHead, true); mem().setUint32(addr, 2, true); return;
                case true: mem().setUint32(addr + 4, nanHead, true); mem().setUint32(addr, 3, true); return;
                case false: mem().setUint32(addr + 4, nanHead, true); mem().setUint32(addr, 4, true); return;
            }
            let id = that._ids.get(v);
            if (id === undefined) {
                id = that._idPool.pop() ?? that._values.length;
                that._values[id] = v;
                that._goRefCounts[id] = 0;
                that._ids.set(v, id);
            }
            that._goRefCounts[id]++;
            let typeFlag = 1;
            if (typeof v === "string") typeFlag = 2;
            else if (typeof v === "symbol") typeFlag = 3;
            else if (typeof v === "function") typeFlag = 4;
            mem().setUint32(addr + 4, nanHead | typeFlag, true);
            mem().setUint32(addr, id, true);
        };

        const loadSlice = (addr: number, len: number) => new Uint8Array((that._inst!.exports.memory as WebAssembly.Memory).buffer, addr, len);
        const loadString = (ptr: number, len: number) => decoder.decode(new DataView((that._inst!.exports.memory as WebAssembly.Memory).buffer, ptr, len));

        const timeOrigin = Date.now() - performance.now();

        return {
            wasi_snapshot_preview1: {
                fd_write: (fd: number, iovs_ptr: number, iovs_len: number, nwritten_ptr: number) => {
                    let nwritten = 0;
                    if (fd === 1 || fd === 2) {
                        for (let i = 0; i < iovs_len; i++) {
                            const iov_ptr = iovs_ptr + i * 8;
                            const ptr = mem().getUint32(iov_ptr + 0, true);
                            const len = mem().getUint32(iov_ptr + 4, true);
                            for (let j = 0; j < len; j++) {
                                const c = mem().getUint8(ptr + j);
                                if (c === 13) continue;
                                if (c === 10) {
                                    const line = decoder.decode(new Uint8Array(that._logLine));
                                    that._logLine = [];
                                    console.log(line);
                                } else {
                                    that._logLine.push(c);
                                }
                            }
                            nwritten += len;
                        }
                    }
                    mem().setUint32(nwritten_ptr, nwritten, true);
                    return 0;
                },
                proc_exit: (code: number) => {
                    that.exited = true;
                    that._resolveExitPromise?.();
                    if (typeof that.sandboxGlobal.process?.exit === "function") {
                        that.sandboxGlobal.process.exit(code);
                    }
                },
            },
            env: {
                "runtime.ticks": () => timeOrigin + performance.now(),
                "runtime.sleepTicks": (timeout: number) => {
                    setTimeout(() => {
                        // @ts-ignore - scheduler
                        that._inst!.exports.go_scheduler?.();
                        if (that.exited) that._resolveExitPromise?.();
                    }, timeout);
                },
                "syscall/js.finalizeRef": (sp: number) => {
                    const id = mem().getUint32(sp + 8, true);
                    if (id >= that._goRefCounts.length || id < 0) return;
                    that._goRefCounts[id]--;
                    if (that._goRefCounts[id] === 0) {
                        const v = that._values[id];
                        that._values[id] = undefined;
                        that._ids.delete(v);
                        that._idPool.push(id);
                    }
                },
                // ... all other syscall/js.* unchanged from your version
                "syscall/js.stringVal": (ret_ptr: number, value_ptr: number, value_len: number) => {
                    const s = loadString(value_ptr, value_len);
                    storeValue(ret_ptr, s);
                },
                "syscall/js.valueGet": (retval: number, v_addr: number, p_ptr: number, p_len: number) => {
                    const prop = loadString(p_ptr, p_len);
                    let value = loadValue(v_addr);
                    let result = Reflect.get(value, prop);
                    if (result === undefined && value === that.sandboxGlobal) {
                        result = Reflect.get(globalThis, prop);
                    }
                    storeValue(retval, result);
                },
                // ... (rest of your syscall/js implementations remain exactly as you had them)
                "syscall/js.valueSet": (v_addr: number, p_ptr: number, p_len: number, x_addr: number) => {
                    const v = loadValue(v_addr);
                    const p = loadString(p_ptr, p_len);
                    const x = loadValue(x_addr);
                    Reflect.set(v, p, x);
                },
                "syscall/js.valueDelete": (v_addr: number, p_ptr: number, p_len: number) => {
                    const v = loadValue(v_addr);
                    const p = loadString(p_ptr, p_len);
                    Reflect.deleteProperty(v, p);
                },
                "syscall/js.valueIndex": (ret_addr: number, v_addr: number, i: number) => {
                    storeValue(ret_addr, Reflect.get(loadValue(v_addr), i));
                },
                "syscall/js.valueSetIndex": (v_addr: number, i: number, x_addr: number) => {
                    Reflect.set(loadValue(v_addr), i, loadValue(x_addr));
                },
                "syscall/js.valueCall": (ret_addr: number, v_addr: number, m_ptr: number, m_len: number, args_ptr: number, args_len: number, args_cap: number) => {
                    const v = loadValue(v_addr);
                    const name = loadString(m_ptr, m_len);
                    const args = new Array(args_len);
                    for (let i = 0; i < args_len; i++) args[i] = loadValue(args_ptr + i * 8);
                    try {
                        const m = Reflect.get(v, name);
                        storeValue(ret_addr, Reflect.apply(m, v, args));
                        mem().setUint8(ret_addr + 8, 1);
                    } catch (err) {
                        storeValue(ret_addr, err);
                        mem().setUint8(ret_addr + 8, 0);
                    }
                },
                "syscall/js.valueInvoke": (ret_addr: number, v_addr: number, args_ptr: number, args_len: number, args_cap: number) => {
                    try {
                        const v = loadValue(v_addr);
                        const args = new Array(args_len);
                        for (let i = 0; i < args_len; i++) args[i] = loadValue(args_ptr + i * 8);
                        storeValue(ret_addr, Reflect.apply(v, undefined, args));
                        mem().setUint8(ret_addr + 8, 1);
                    } catch (err) {
                        storeValue(ret_addr, err);
                        mem().setUint8(ret_addr + 8, 0);
                    }
                },
                "syscall/js.valueNew": (ret_addr: number, v_addr: number, args_ptr: number, args_len: number, args_cap: number) => {
                    const v = loadValue(v_addr);
                    const args = new Array(args_len);
                    for (let i = 0; i < args_len; i++) args[i] = loadValue(args_ptr + i * 8);
                    try {
                        storeValue(ret_addr, Reflect.construct(v, args));
                        mem().setUint8(ret_addr + 8, 1);
                    } catch (err) {
                        storeValue(ret_addr, err);
                        mem().setUint8(ret_addr + 8, 0);
                    }
                },
                "syscall/js.valueLength": (v_addr: number) => loadValue(v_addr).length,
                "syscall/js.valuePrepareString": (ret_addr: number, v_addr: number) => {
                    const s = String(loadValue(v_addr));
                    const str = new TextEncoder().encode(s);
                    storeValue(ret_addr, str);
                    setInt64(ret_addr + 8, str.length);
                },
                "syscall/js.valueLoadString": (v_addr: number, slice_ptr: number, slice_len: number, slice_cap: number) => {
                    const str = loadValue(v_addr) as Uint8Array;
                    loadSlice(slice_ptr, slice_len).set(str.subarray(0, slice_len));
                },
                "syscall/js.valueInstanceOf": (v_addr: number, t_addr: number) => (loadValue(v_addr) instanceof loadValue(t_addr) ? 1 : 0),
                "syscall/js.copyBytesToGo": (ret_addr: number, dest_addr: number, dest_len: number, dest_cap: number, source_addr: number) => {
                    const dst = loadSlice(dest_addr, dest_len);
                    const src = loadValue(source_addr);
                    if (!(src instanceof Uint8Array)) {
                        mem().setUint8(ret_addr + 4, 0);
                        return;
                    }
                    const toCopy = src.subarray(0, dst.length);
                    dst.set(toCopy);
                    setInt64(ret_addr, toCopy.length);
                    mem().setUint8(ret_addr + 4, 1);
                },
                "syscall/js.copyBytesToJS": (ret_addr: number, dest_addr: number, source_addr: number, source_len: number, source_cap: number) => {
                    const dst = loadValue(dest_addr);
                    const src = loadSlice(source_addr, source_len);
                    if (!(dst instanceof Uint8Array)) {
                        mem().setUint8(ret_addr + 4, 0);
                        return;
                    }
                    const toCopy = src.subarray(0, dst.length);
                    dst.set(toCopy);
                    setInt64(ret_addr, toCopy.length);
                    mem().setUint8(ret_addr + 4, 1);
                },
            },
        };
    }

    async run(instance: WebAssembly.Instance): Promise<void> {
        this._inst = instance;

        // Reset runtime state
        this._values = [NaN, 0, null, true, false, this.sandboxGlobal, this];
        this._goRefCounts = new Array(this._values.length).fill(0);
        this._ids = new Map();
        this._idPool = [];
        this.exited = false;
        this._exitPromise = new Promise<void>((resolve) => {
            this._resolveExitPromise = resolve;
        });

        // Start the Go program (synchronous start)
        const start = this._inst.exports._start ?? this._inst.exports.run;
        if (typeof start === "function") {
            start();
        }

        // If program exited synchronously (pure sync main), resolve immediately
        if (this.exited) {
            this._resolveExitPromise?.();
        }

        // Await normal exit (handles both sync and async cases)
        await this._exitPromise;
    }

    private _resume() {
        if (this.exited) {
            throw new Error("Go program has already exited");
        }
        const resume = this._inst!.exports.resume ?? this._inst!.exports.go_scheduler;
        if (typeof resume === "function") {
            resume();
        }
        if (this.exited) {
            this._resolveExitPromise?.();
        }
    }

    _makeFuncWrapper(id: number) {
        // deno-lint-ignore no-this-alias
        const go = this;
        return function (this: any) {
            const event = {
                id,
                this: this,
                args: arguments,
                result: undefined,
            };
            go._pendingEvent = event;
            go._resume();
            return event.result;
        };
    }

    get global() {
        return this.sandboxGlobal;
    }
}