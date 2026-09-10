import { createContext, useContext } from 'react'

export const WorkspaceNavigationContext = createContext([])
export const useWorkspaceNavigation = () => useContext(WorkspaceNavigationContext)
