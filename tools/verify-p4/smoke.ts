import { sha256Hex } from '../../src/shared/vpm/domain/hash'
console.log('smoke', sha256Hex('x').slice(0, 8))
