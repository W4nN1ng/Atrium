/** IPC 注册器的类型：泛型保证处理函数的入参类型不被抹平成 unknown */
export interface IpcApi {
  handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void
}

export interface IpcRegistrar {
  ipc: IpcApi
  broadcast(event: string, payload?: unknown): void
}
