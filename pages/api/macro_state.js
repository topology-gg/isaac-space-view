import clientPromise from "../../lib/mongodb"
import { DB_NAME } from "./db_name"

export default async function handler(req, res) {
    const client = await clientPromise

    const db = client.db(DB_NAME)
    const macro_states = await db
        .collection('u0' + '_macro_states')
        .find({'_chain.valid_to' : null})
        .project({ 'phi': 1, 'dynamics': 1, 'block_number': 1 })
        .sort({ 'block_number': -1 })
        .toArray()

    res.status(200).json({ 'macro_states': macro_states })
}