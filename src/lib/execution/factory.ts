import type { Executor } from './types'
import { BinaryExecutor } from './binary-executor'
import { SpotExecutor } from './spot-executor'
import { FuturesExecutor } from './futures-executor'
import type { BotMode } from '@/types'

const executors: Record<string, Executor> = {
  'binary': new BinaryExecutor(),
  'spot': new SpotExecutor(),
  'futures': new FuturesExecutor(),
}

export function getExecutor(mode: BotMode): Executor {
  return executors[mode] || executors['binary']
}
