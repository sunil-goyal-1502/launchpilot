'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Trash2, Loader2 } from 'lucide-react';
import { destroyDeployment } from '@/lib/api-client';

export function DestroyDialog({ deploymentId, onDestroyed }: { deploymentId: string; onDestroyed: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDestroy = async () => {
    setLoading(true);
    try {
      await destroyDeployment(deploymentId);
      setOpen(false);
      onDestroyed();
    } catch {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="mr-2 h-4 w-4" /> Destroy Infrastructure
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Destroy Infrastructure</DialogTitle>
          <DialogDescription>
            This will permanently destroy all deployed AWS resources. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleDestroy} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Destroy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
