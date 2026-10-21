import { Readable } from 'node:stream'
import type {
  VpmHttpTransport,
  VpmHttpTransportRequest,
  VpmHttpTransportResponse
} from '../../../src/main/vpm/http'

export class FakeTransport implements VpmHttpTransport {
  readonly calls: VpmHttpTransportRequest[] = []
  handler: (input: VpmHttpTransportRequest) => VpmHttpTransportResponse | Promise<VpmHttpTransportResponse> =
    () => reply(200, '{}')

  request(input: VpmHttpTransportRequest): Promise<VpmHttpTransportResponse> {
    this.calls.push(input)
    return Promise.resolve().then(() => this.handler(input))
  }
}

export function reply(
  status: number,
  body?: string | Buffer | Readable,
  headers: Record<string, string | string[]> = {}
): VpmHttpTransportResponse {
  const stream =
    body instanceof Readable
      ? body
      : Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)])
  return { status, headers, body: stream }
}
