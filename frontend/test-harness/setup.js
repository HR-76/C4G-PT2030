// Confirmed reads live in memory for the whole test file; each test starts without them.
import { beforeEach } from 'vitest'
import { clearConfirmedReads } from '../src/api/confirmedReads'
beforeEach(() => clearConfirmedReads())
