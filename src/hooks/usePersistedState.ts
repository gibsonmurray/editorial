import { useEffect, useState } from "react"

export function usePersistedState<T>(
    key: string,
    initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [v, setV] = useState<T>(() => {
        try {
            const raw = localStorage.getItem(`editorial:${key}`)
            if (raw === null) return initial
            return JSON.parse(raw) as T
        } catch {
            return initial
        }
    })
    useEffect(() => {
        try {
            localStorage.setItem(`editorial:${key}`, JSON.stringify(v))
        } catch {}
    }, [key, v])
    return [v, setV]
}
