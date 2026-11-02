# QA only. An unnamed job holds THIS process and its future descendants.
# Parent closes its own ChildProcess handle; no PID-based termination.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class QaUpgradeJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long ProcessTime,JobTime;
    public uint Flags;
    public UIntPtr MinWorkingSet,MaxWorkingSet;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint Priority,Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Counters {
    public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct Extended {
    public Basic Basic;
    public Counters IO;
    public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended limits,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
  static IntPtr held=IntPtr.Zero;
  public static void Enter() {
    if(held!=IntPtr.Zero)throw new InvalidOperationException("Job already entered");
    IntPtr candidate=CreateJobObject(IntPtr.Zero,null);
    if(candidate==IntPtr.Zero)throw new Win32Exception();
    Extended limits=new Extended(); limits.Basic.Flags=0x2000;
    if(!SetInformationJobObject(candidate,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended))) || !AssignProcessToJobObject(candidate,GetCurrentProcess())) {
      int error=Marshal.GetLastWin32Error(); CloseHandle(candidate); throw new Win32Exception(error);
    }
    held=candidate;
  }
}
'@
[QaUpgradeJob]::Enter()
Write-Host 'QA_JOB_ENTERED'
