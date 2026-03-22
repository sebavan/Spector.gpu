import { createContext, useContext } from 'react';

export type ResourceCategory =
    | 'buffers'
    | 'textures'
    | 'textureViews'
    | 'samplers'
    | 'shaderModules'
    | 'renderPipelines'
    | 'computePipelines'
    | 'bindGroups'
    | 'bindGroupLayouts';

export interface NavigationTarget {
    readonly category: ResourceCategory;
    readonly id: string;
}

export type NavigateToResource = (target: NavigationTarget) => void;

/** Navigate to a command node by its id (e.g. "cmd_42"). */
export type NavigateToCommand = (commandId: string) => void;

// Default is a no-op — safe for components rendered outside the provider (tests, etc).
export const NavigationContext = createContext<NavigateToResource>(() => {});
export const CommandNavigationContext = createContext<NavigateToCommand>(() => {});

export function useNavigateToResource(): NavigateToResource {
    return useContext(NavigationContext);
}

export function useNavigateToCommand(): NavigateToCommand {
    return useContext(CommandNavigationContext);
}
