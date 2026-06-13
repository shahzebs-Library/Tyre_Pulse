import { createContext, useContext, useState } from 'react'

const Ctx = createContext(null)

export function CommandPaletteProvider({ children }) {
  const [open, setOpen] = useState(false)
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>
}

export function useCommandPalette() {
  return useContext(Ctx)
}
