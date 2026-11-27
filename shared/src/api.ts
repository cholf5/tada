import type { EntityMap, EntityName } from './entities';

/** 一次同步记录：某实体某一行在某个时刻的状态 */
export interface WireChange<E extends EntityName = EntityName> {
  entity: E;
  id: string;
  hlc: string;
  deleted: boolean;
  /** deleted 为 true 时可省略 */
  data?: EntityMap[E];
}

export interface PushRequest {
  changes: WireChange[];
}

export interface PushResponse {
  lastSeq: number;
}

export interface PullResponse {
  changes: WireChange[];
  nextSince: number;
  hasMore: boolean;
}

export interface PairRequest {
  code: string;
  deviceName: string;
}

export interface PairResponse {
  token: string;
}
