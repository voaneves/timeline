import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Events } from '../sources/Game/Events.js'

test('Events.trigger runs callbacks in numeric order, fractional included (3, 5.5, 7, 998)', () =>
{
    const events = new Events()
    const log = []

    // Registered out of order on purpose
    events.on('tick', () => log.push(998), 998)
    events.on('tick', () => log.push(7), 7)
    events.on('tick', () => log.push(5.5), 5.5)
    events.on('tick', () => log.push(3), 3)

    events.trigger('tick')

    assert.deepEqual(log, [ 3, 5.5, 7, 998 ])
})

test('Events keeps registration order inside the same order and passes arguments', () =>
{
    const events = new Events()
    const log = []

    events.on('x', (a) => log.push([ 'first', a ]), 2)
    events.on('x', (a) => log.push([ 'second', a ]), 2)
    events.on('x', (a) => log.push([ 'early', a ]), 0)

    events.trigger('x', [ 42 ])

    assert.deepEqual(log, [ [ 'early', 42 ], [ 'first', 42 ], [ 'second', 42 ] ])
})

test('Events.off removes one callback or every callback of a name', () =>
{
    const events = new Events()
    const log = []
    const a = () => log.push('a')
    const b = () => log.push('b')

    events.on('x', a, 1).on('x', b, 5.5)
    events.off('x', a)
    events.trigger('x')
    assert.deepEqual(log, [ 'b' ])

    events.off('x')
    events.trigger('x')
    assert.deepEqual(log, [ 'b' ])
})

test('upstream bug repro: sparse array + for...in runs 5.5 after 998', () =>
{
    const e = []
    e[3] = [ 'p' ]
    e[5.5] = [ 'c' ]
    e[7] = [ 'v' ]
    e[998] = [ 'r' ]
    assert.deepEqual(Object.keys(e), [ '3', '7', '998', '5.5' ])
})
