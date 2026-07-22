/**
 * Selves — app shell. Three-panel workspace preserved.
 */

import { useState } from 'react';
import { useSelvesState } from './hooks/useSelvesState';
import { LeftSidebar } from './components/LeftSidebar';
import { CenterFeed } from './components/CenterFeed';
import { RightSidebar } from './components/RightSidebar';
import { LivingGraph } from './components/LivingGraph';
import { Menu, Info, Sliders } from 'lucide-react';

export default function App() {
  const state = useSelvesState();
  const [mobileView, setMobileView] = useState<'left' | 'center' | 'right'>('center');

  // Selves the current Self can address: connected in either direction.
  const connectedIds: string[] = Array.from(
    new Set<string>(
      state.connections
        .filter(
          c =>
            c.status === 'connected' &&
            (c.fromSelfId === state.currentSelfId || c.toSelfId === state.currentSelfId)
        )
        .map(c => (c.fromSelfId === state.currentSelfId ? c.toSelfId : c.fromSelfId))
    )
  );

  return (
    <div className="w-full h-screen bg-black text-neutral-100 font-sans flex flex-col md:flex-row overflow-hidden selection:bg-neutral-800 selection:text-white">

      {/* Mobile header */}
      <header className="md:hidden flex items-center justify-between p-3 bg-neutral-950 border-b border-neutral-900 font-mono text-xs shrink-0 select-none">
        <div className="flex items-center gap-1.5">
          <div className="w-4.5 h-4.5 bg-white text-black font-black text-[9px] flex items-center justify-center rounded-sm">S</div>
          <span className="font-bold tracking-tight">SELVES // V2.0</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-neutral-500 uppercase">ACTIVE SELF:</span>
          <span className="font-bold text-neutral-200 uppercase" style={{ color: state.currentSelf.color }}>
            {state.currentSelf.name}
          </span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden h-full">

        {/* LEFT */}
        <div className={`w-full md:w-[280px] shrink-0 h-full ${mobileView === 'left' ? 'block' : 'hidden md:block'}`}>
          <LeftSidebar
            selves={state.selves}
            currentSelfId={state.currentSelfId}
            switchSelf={state.switchSelf}
            createSelf={state.createSelf}
            notifications={state.notifications}
            markNotificationAsRead={state.markNotificationAsRead}
            resolveKeyGrant={state.resolveKeyGrant}
            acceptConnection={state.acceptConnection}
            declineConnection={state.declineConnection}
            factoryReset={state.factoryReset}
          />
        </div>

        {/* CENTER: Living Graph + Register */}
        <div className={`flex-1 flex flex-col h-full overflow-hidden border-r border-neutral-900/60 ${mobileView === 'center' ? 'flex' : 'hidden md:flex'}`}>

          <div className="shrink-0 p-4 border-b border-neutral-900 bg-neutral-950/20 select-none">
            <LivingGraph
              selves={state.selves}
              connections={state.connections}
              currentSelfId={state.currentSelfId}
              inspectedSelfId={state.inspectedSelfId}
              setInspectedSelfId={state.setInspectedSelfId}
              activeVisualSignals={state.activeVisualSignals}
              updateGraphPosition={state.updateGraphPosition}
              correspondenceVolume={state.correspondenceVolume}
              hasKey={state.hasKey}
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            <CenterFeed
              currentSelf={state.currentSelf}
              selves={state.selves}
              feedFilter={state.feedFilter}
              setFeedFilter={state.setFeedFilter}
              visiblePlacements={state.getVisiblePlacements()}
              createPlacement={state.createPlacement}
              createPollPlacement={state.createPollPlacement}
              addReply={state.addReply}
              toggleBookmark={state.toggleBookmark}
              bookmarks={state.bookmarks}
              voteInPoll={state.voteInPoll}
              polls={state.polls}
              deriveRing={state.deriveRing}
              connectedIds={connectedIds}
            />
          </div>
        </div>

        {/* RIGHT */}
        <div className={`w-full md:w-[320px] shrink-0 h-full ${mobileView === 'right' ? 'block' : 'hidden md:block'}`}>
          <RightSidebar
            currentSelf={state.currentSelf}
            selves={state.selves}
            placements={state.placements}
            inspectedSelfId={state.inspectedSelfId}
            setInspectedSelfId={state.setInspectedSelfId}
            connections={state.connections}
            keyGrants={state.keyGrants}
            setBoundedDisclosure={state.setBoundedDisclosure}
            requestKey={state.requestKey}
            initiateConnection={state.initiateConnection}
            deriveRing={state.deriveRing}
            hasKey={state.hasKey}
          />
        </div>

      </div>

      {/* Mobile nav */}
      <footer className="md:hidden grid grid-cols-3 bg-neutral-950 border-t border-neutral-900 text-center font-mono text-[10px] uppercase shrink-0 py-1.5 select-none z-30">
        <button
          onClick={() => setMobileView('left')}
          className={`flex flex-col items-center gap-0.5 justify-center py-1 transition-colors ${mobileView === 'left' ? 'text-white font-bold' : 'text-neutral-500'}`}
        >
          <Menu size={14} />
          <span>SWITCHER</span>
        </button>
        <button
          onClick={() => setMobileView('center')}
          className={`flex flex-col items-center gap-0.5 justify-center py-1 transition-colors ${mobileView === 'center' ? 'text-white font-bold' : 'text-neutral-500'}`}
        >
          <Sliders size={14} />
          <span>REGISTER</span>
        </button>
        <button
          onClick={() => setMobileView('right')}
          className={`flex flex-col items-center gap-0.5 justify-center py-1 transition-colors ${mobileView === 'right' ? 'text-white font-bold' : 'text-neutral-500'}`}
        >
          <Info size={14} />
          <span>INSPECTOR</span>
        </button>
      </footer>

    </div>
  );
}
