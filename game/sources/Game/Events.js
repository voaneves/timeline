// Change: callbacks are grouped by order in a Map and triggered in numeric ascending order,
// so fractional orders (5.5) run between 5 and 7. Upstream used a sparse array + for...in,
// which enumerates integer keys first and string keys (5.5) last (after the render at 998).
export class Events
{
    constructor()
    {
        this.callbacks = new Map() // name => { byOrder: Map(order => [ callbacks ]), orders: [ sorted order numbers ] }
    }

    on(_name, _callback, _order = 1)
    {
        // Create entry if needed
        let entry = this.callbacks.get(_name)
        if(!entry)
        {
            entry = { byOrder: new Map(), orders: [] }
            this.callbacks.set(_name, entry)
        }

        // Create order array if needed
        let callbacks = entry.byOrder.get(_order)
        if(!callbacks)
        {
            callbacks = []
            entry.byOrder.set(_order, callbacks)
            entry.orders.push(_order)
            entry.orders.sort((a, b) => a - b)
        }

        // Save callback
        callbacks.push(_callback)

        return this
    }

    off(_name, _callback = null)
    {
        // Remove specific
        if(typeof _callback === 'function')
        {
            const entry = this.callbacks.get(_name)

            if(entry)
            {
                for(const callbacks of entry.byOrder.values())
                {
                    const index = callbacks.indexOf(_callback)

                    if(index !== -1)
                        callbacks.splice(index, 1)
                }
            }
        }

        // Remove all
        else
        {
            this.callbacks.delete(_name)
        }

        return this
    }

    trigger(_name, _arguments = [])
    {
        const entry = this.callbacks.get(_name)

        if(entry)
        {
            for(const order of entry.orders)
            {
                for(const _callbackFunction of entry.byOrder.get(order))
                {
                    _callbackFunction.apply(this, _arguments)
                }
            }
        }

        return this
    }
}
