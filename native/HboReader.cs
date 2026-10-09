using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class HboReader {
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr count, out UIntPtr read);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static readonly DateTime Epoch = new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc);
  static Dictionary<string,object> profile;
  static Dictionary<int,uint> thresholds;
  static IntPtr handle;
  static Process game;
  static ulong moduleBase;
  static uint? previousExperience, previousRequired;
  static ulong? previousObject;
  static string previousCharacter;
  static long earned;

  static uint Config(string key) { return Convert.ToUInt32(profile[key]); }
  static void Write(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
  static byte[] Read(ulong address, int size) {
    byte[] data = new byte[size]; UIntPtr read;
    if (!ReadProcessMemory(handle, new IntPtr((long)address), data, (UIntPtr)size, out read) || read.ToUInt64() != (ulong)size)
      throw new Exception("遊戲資料目前無法讀取，請確認已進入角色並重新開始監測。");
    return data;
  }
  public static ulong Resolve(ulong baseAddress, uint rootRva, uint offset, Func<ulong,int,byte[]> read) {
    uint pointer = BitConverter.ToUInt32(read(baseAddress + rootRva,4),0);
    if (pointer < 0x10000 || (pointer & 3) != 0 || (ulong)pointer + offset > uint.MaxValue)
      throw new Exception("角色指標尚未就緒，請进入遊戲角色後重新開始。");
    return (ulong)pointer + offset;
  }
  static int? Level(uint required) {
    int? found = null;
    foreach (KeyValuePair<int,uint> entry in thresholds) if (entry.Value == required) {
      if (found.HasValue) return null;
      found = entry.Key;
    }
    return found;
  }
  public static byte[] ReadString(ulong address, int maxBytes, Func<ulong,int,byte[]> read) {
    byte[] value = read(address,24);
    uint length = BitConverter.ToUInt32(value,16), capacity = BitConverter.ToUInt32(value,20);
    if (length == 0 || length > maxBytes || capacity < length || capacity > 4096) return null;
    if (capacity < 16) {
      if (length > 15 || value[length] != 0) return null;
      byte[] result = new byte[length]; Array.Copy(value,result,(int)length); return result;
    }
    uint pointer = BitConverter.ToUInt32(value,0);
    if (pointer < 0x10000 || (ulong)pointer + length > uint.MaxValue) return null;
    byte[] heap = read(pointer,(int)length+1);
    if (heap[length] != 0) return null;
    byte[] text = new byte[length]; Array.Copy(heap,text,(int)length); return text;
  }
  static string DecodeName(byte[] bytes) {
    if (bytes == null) return null;
    try {
      string value = new UTF8Encoding(false,true).GetString(bytes);
      foreach (char c in value) if (char.IsControl(c) || char.IsWhiteSpace(c)) return null;
      return value;
    } catch (DecoderFallbackException) { return null; }
  }
  public static string ReadProfession(ulong baseAddress, uint rootRva, uint actorOffset,
      uint nameOffset, uint professionOffset, string expectedName,
      Dictionary<string,object> names, Func<ulong,int,byte[]> read) {
    if (expectedName == null) return null;
    ulong actorSlot = Resolve(baseAddress,rootRva,actorOffset,read);
    uint actor = BitConverter.ToUInt32(read(actorSlot,4),0);
    if (actor < 0x10000 || (actor & 3) != 0 || (ulong)actor + Math.Max(nameOffset+32,professionOffset+2) > uint.MaxValue) return null;
    byte[] nameBuffer = read((ulong)actor+nameOffset,32);
    int end = Array.IndexOf(nameBuffer,(byte)0);
    if (end <= 0) return null;
    byte[] nameBytes = new byte[end]; Array.Copy(nameBuffer,nameBytes,end);
    if (DecodeName(nameBytes) != expectedName) return null;
    short code = BitConverter.ToInt16(read((ulong)actor+professionOffset,2),0);
    // Reject an actor replacement during the read rather than mixing two roles.
    if (BitConverter.ToUInt32(read(actorSlot,4),0) != actor ||
        Resolve(baseAddress,rootRva,actorOffset,read) != actorSlot) return null;
    byte[] confirmedName = read((ulong)actor+nameOffset,32);
    for (int i=0; i<=end; i++) if (confirmedName[i] != nameBuffer[i]) return null;
    object label;
    return names.TryGetValue(code.ToString(System.Globalization.CultureInfo.InvariantCulture),out label) ? (string)label : null;
  }
  public static int? ReadGold(ulong baseAddress, uint rootRva, uint actorOffset,
      uint nameOffset, uint goldOffset, string expectedName, Func<ulong,int,byte[]> read) {
    if (expectedName == null) return null;
    ulong actorSlot = Resolve(baseAddress,rootRva,actorOffset,read);
    uint actor = BitConverter.ToUInt32(read(actorSlot,4),0);
    if (actor < 0x10000 || (actor & 3) != 0 || (ulong)actor + Math.Max(nameOffset+32,goldOffset+4) > uint.MaxValue) return null;
    byte[] name = read((ulong)actor+nameOffset,32);
    int end = Array.IndexOf(name,(byte)0);
    if (end <= 0) return null;
    byte[] bytes = new byte[end]; Array.Copy(name,bytes,end);
    if (DecodeName(bytes) != expectedName) return null;
    int gold = BitConverter.ToInt32(read((ulong)actor+goldOffset,4),0);
    if (gold < 0 || BitConverter.ToInt32(read((ulong)actor+goldOffset,4),0) != gold ||
        Resolve(baseAddress,rootRva,actorOffset,read) != actorSlot ||
        BitConverter.ToUInt32(read(actorSlot,4),0) != actor) return null;
    byte[] confirmedName = read((ulong)actor+nameOffset,32);
    for (int i=0; i<=end; i++) if (name[i] != confirmedName[i]) return null;
    return gold;
  }
  static void Identity(out string character, out string profession) {
    character = null; profession = null;
    // Read only the name member of the application object, never account fields.
    ulong nameAddress = Resolve(moduleBase,Config("identityRootRva"),Config("identityNameOffset"),Read);
    character = DecodeName(ReadString(nameAddress,96,Read));
    try {
      profession = ReadProfession(moduleBase,Config("professionRootRva"),Config("professionActorOffset"),
        Config("professionNameOffset"),Config("professionCodeOffset"),character,
        (Dictionary<string,object>)profile["professionTable"],Read);
    } catch (Exception) {
      // An unavailable or unconfirmed actor must not be presented as a known job.
      profession = null;
    }
  }
  public static long Gain(uint before, uint beforeRequired, uint after, uint afterRequired, Dictionary<int,uint> table) {
    if (beforeRequired == afterRequired) {
      if (after < before) throw new Exception("經驗值下降或角色狀態已改變，已停止統計；請重新開始監測。");
      return (long)after - before;
    }
    int previous = 0, current = 0;
    foreach (KeyValuePair<int,uint> entry in table) {
      if (entry.Value == beforeRequired) previous = entry.Key;
      if (entry.Value == afterRequired) current = entry.Key;
    }
    if (previous == 0 || current <= previous) throw new Exception("無法確認跨等級資料，請重新開始監測。");
    long delta = (long)beforeRequired - before + after;
    for (int level=previous+1; level<current; level++) {
      uint required;
      if (!table.TryGetValue(level,out required)) throw new Exception("缺少等級經驗資料。");
      delta += required;
    }
    return delta;
  }
  public static bool ReadConsistentExperience(ulong baseAddress, uint rootRva, uint offset,
      Dictionary<int,uint> table, Func<ulong,int,byte[]> read,
      out ulong address, out uint required, out uint experience) {
    address = Resolve(baseAddress,rootRva,offset,read);
    byte[] first = read(address,8);
    required = BitConverter.ToUInt32(first,0); experience = BitConverter.ToUInt32(first,4);
    ulong confirmedAddress = Resolve(baseAddress,rootRva,offset,read);
    byte[] confirmed = read(confirmedAddress,8);
    return address == confirmedAddress && required == BitConverter.ToUInt32(confirmed,0) &&
      experience == BitConverter.ToUInt32(confirmed,4) && required > 0 && experience < required && table.ContainsValue(required);
  }
  static object Sample() {
    if (game.HasExited) throw new Exception("遊戲已關閉，請重新開啟遊戲後開始監測。");
    for (int attempt=0; attempt<5; attempt++) {
      ulong first; uint required, experience;
      if (!ReadConsistentExperience(moduleBase,Config("primaryRootRva"),Config("primaryRequiredOffset"),thresholds,Read,
          out first,out required,out experience)) {
        Thread.Sleep(20); continue;
      }
      if (previousObject.HasValue && previousObject.Value != first)
        throw new Exception("角色資料位置已改變，請重新開始監測以建立新的統計。");
      string character, profession;
      Identity(out character,out profession);
      if (previousCharacter != null && character != previousCharacter)
        throw new Exception("角色名稱已改變或無法確認，已停止統計；請重新開始監測。");
      int? gold = null;
      try {
        gold = ReadGold(moduleBase,Config("goldRootRva"),Config("goldActorOffset"),
          Config("goldNameOffset"),Config("goldValueOffset"),character,Read);
      } catch (Exception) { gold = null; }
      if (previousExperience.HasValue)
        earned += Gain(previousExperience.Value,previousRequired.Value,experience,required,thresholds);
      previousExperience=experience; previousRequired=required; previousObject=first;
      previousCharacter=character;
      return new {
        type="sample",
        sample=new {
          timestamp=(long)(DateTime.UtcNow-Epoch).TotalMilliseconds,
          character=character, profession=profession, level=Level(required), experience=experience,
          experienceRequired=required, gold=gold, earnedExperience=earned,
          processId=game.Id
        }
      };
    }
    throw new Exception("角色資料驗證失敗，請確認已進入遊戲角色；此版本暫不顯示未確認的數值。");
  }
  static int SelfTest() {
    Func<ulong,int,byte[]> first = (address,size) => {
      if (address != 0x400000+0x361afc) throw new Exception("Wrong root");
      return BitConverter.GetBytes((uint)0x589cb90);
    };
    Func<ulong,int,byte[]> relocated = (address,size) => {
      if (address != 0x500000+0x361afc) throw new Exception("Wrong relocated root");
      return BitConverter.GetBytes((uint)0x12340000);
    };
    if (Resolve(0x400000,0x361afc,0x1b4,first) != 0x589cd44 ||
        Resolve(0x500000,0x361afc,0x1b4,relocated) != 0x123401b4)
      throw new Exception("Pointer relocation test failed");
    Dictionary<int,uint> table = new Dictionary<int,uint> { {40,1000},{41,1200},{42,1500} };
    if (Gain(990,1000,20,1200,table) != 30 ||
        Gain(990,1000,20,1500,table) != 1230 ||
        Gain(100,1000,150,1000,table) != 50) throw new Exception("Experience test failed");
    bool rejected=false; try { Gain(150,1000,100,1000,table); } catch { rejected=true; }
    if (!rejected) throw new Exception("Reset was not rejected");
    byte[] inline = new byte[24];
    Array.Copy(Encoding.UTF8.GetBytes("moooo"),inline,5);
    Array.Copy(BitConverter.GetBytes((uint)5),0,inline,16,4);
    Array.Copy(BitConverter.GetBytes((uint)15),0,inline,20,4);
    if (DecodeName(ReadString(0x10000,96,(address,size) => inline)) != "moooo")
      throw new Exception("Inline name test failed");
    byte[] heapString = (byte[])inline.Clone();
    Array.Copy(BitConverter.GetBytes((uint)0x20000),0,heapString,0,4);
    Array.Copy(BitConverter.GetBytes((uint)31),0,heapString,20,4);
    if (DecodeName(ReadString(0x10000,96,(address,size) => address == 0x10000 ? heapString : Encoding.UTF8.GetBytes("moooo\0"))) != "moooo")
      throw new Exception("Heap name test failed");
    inline[5]=1;
    if (ReadString(0x10000,96,(address,size) => inline) != null ||
        DecodeName(new byte[] { 0xe2,0xd8 }) != null)
      throw new Exception("Invalid name was accepted");
    Array.Copy(BitConverter.GetBytes((uint)5000),0,inline,16,4);
    if (ReadString(0x10000,96,(address,size) => inline) != null)
      throw new Exception("Unbounded name was accepted");
    var jobs = new Dictionary<string,object> { {"110","戰士"},{"220","盜賊"},{"1000","初心者"} };
    short jobCode=110;
    uint actorPointer=0x30000;
    Func<ulong,int,byte[]> actorRead = (address,size) => {
      if (address == 0x500000+0x35b914) return BitConverter.GetBytes((uint)0x20000);
      if (address == 0x20078) return BitConverter.GetBytes(actorPointer);
      if (address == 0x30124) { byte[] name=new byte[32]; Array.Copy(Encoding.UTF8.GetBytes("moooo"),name,5); return name; }
      if (address == 0x3014e) return BitConverter.GetBytes(jobCode);
      throw new Exception("Unexpected profession address");
    };
    Func<string,string> readJob = name => ReadProfession(0x500000,0x35b914,0x78,0x124,0x14e,name,jobs,actorRead);
    if (readJob("moooo") != "戰士" || readJob("other") != null || readJob(null) != null)
      throw new Exception("Profession identity validation failed");
    jobCode=220; if (readJob("moooo") != "盜賊") throw new Exception("Profession change failed");
    jobCode=999; if (readJob("moooo") != null) throw new Exception("Unknown profession accepted");
    jobCode=-1; if (readJob("moooo") != null) throw new Exception("Invalid profession accepted");
    actorPointer=0; if (readJob("moooo") != null) throw new Exception("Absent actor accepted");
    actorPointer=0x30000; jobCode=110;
    Func<ulong,int,byte[]> changedActorRead = (address,size) => {
      byte[] value=actorRead(address,size);
      if (address == 0x3014e) actorPointer=0x40000;
      return value;
    };
    if (ReadProfession(0x500000,0x35b914,0x78,0x124,0x14e,"moooo",jobs,changedActorRead) != null)
      throw new Exception("Actor changed during sample was accepted");
    actorPointer=0x30000;
    int nameReads=0;
    Func<ulong,int,byte[]> changedNameRead = (address,size) => {
      byte[] value=actorRead(address,size);
      if (address == 0x30124 && ++nameReads > 1) value[0]=(byte)'x';
      return value;
    };
    if (ReadProfession(0x500000,0x35b914,0x78,0x124,0x14e,"moooo",jobs,changedNameRead) != null)
      throw new Exception("Name changed during sample was accepted");
    uint testRequired=1000, testExperience=250; ulong testAddress; uint actualRequired, actualExperience;
    int rootReads=0;
    Func<ulong,int,byte[]> experienceRead = (address,size) => {
      if (size == 4) { rootReads++; return BitConverter.GetBytes((uint)0x30000); }
      byte[] value=new byte[8]; Array.Copy(BitConverter.GetBytes(testRequired),value,4);
      Array.Copy(BitConverter.GetBytes(testExperience),0,value,4,4); return value;
    };
    if (!ReadConsistentExperience(0x400000,0x100,0x20,table,experienceRead,out testAddress,out actualRequired,out actualExperience) ||
        testAddress != 0x30020 || actualRequired != 1000 || actualExperience != 250) throw new Exception("Stable experience rejected");
    testExperience=1000;
    if (ReadConsistentExperience(0x400000,0x100,0x20,table,experienceRead,out testAddress,out actualRequired,out actualExperience)) throw new Exception("Invalid experience accepted");
    testExperience=250; testRequired=999;
    if (ReadConsistentExperience(0x400000,0x100,0x20,table,experienceRead,out testAddress,out actualRequired,out actualExperience)) throw new Exception("Unknown threshold accepted");
    testRequired=1000; rootReads=0;
    Func<ulong,int,byte[]> replacedRead = (address,size) => {
      byte[] value=experienceRead(address,size);
      return size == 4 && rootReads == 2 ? BitConverter.GetBytes((uint)0x40000) : value;
    };
    if (ReadConsistentExperience(0x400000,0x100,0x20,table,replacedRead,out testAddress,out actualRequired,out actualExperience)) throw new Exception("Replaced object accepted");
    int valueReads=0;
    Func<ulong,int,byte[]> changedRead = (address,size) => {
      byte[] value=experienceRead(address,size);
      if (size == 8 && ++valueReads == 2) Array.Copy(BitConverter.GetBytes((uint)251),0,value,4,4);
      return value;
    };
    if (ReadConsistentExperience(0x400000,0x100,0x20,table,changedRead,out testAddress,out actualRequired,out actualExperience)) throw new Exception("Mixed sample accepted");
    int money=70000;
    Func<ulong,int,byte[]> goldRead = (address,size) => address == 0x30018 ? BitConverter.GetBytes(money) : actorRead(address,size);
    Func<string,int?> readGold = name => ReadGold(0x500000,0x35b914,0x78,0x124,0x18,name,goldRead);
    if (readGold("moooo") != 70000) throw new Exception("Gold was truncated to 16 bits");
    money=0; if (readGold("moooo") != 0) throw new Exception("Zero gold rejected");
    money=int.MaxValue; if (readGold("moooo") != int.MaxValue) throw new Exception("Maximum gold rejected");
    money=-1; if (readGold("moooo") != null) throw new Exception("Negative gold accepted");
    money=304;
    if (readGold("other") != null || readGold(null) != null) throw new Exception("Unknown gold identity accepted");
    actorPointer=0;
    if (readGold("moooo") != null) throw new Exception("Absent gold actor accepted");
    actorPointer=0x30000;
    Func<ulong,int,byte[]> swappedGoldRead = (address,size) => {
      byte[] value=goldRead(address,size);
      if (address == 0x30018) actorPointer=0x40000;
      return value;
    };
    if (ReadGold(0x500000,0x35b914,0x78,0x124,0x18,"moooo",swappedGoldRead) != null) throw new Exception("Gold actor replacement accepted");
    actorPointer=0x30000; int goldNameReads=0;
    Func<ulong,int,byte[]> changedGoldNameRead = (address,size) => {
      byte[] value=goldRead(address,size);
      if (address == 0x30124 && ++goldNameReads > 1) value[0]=(byte)'x';
      return value;
    };
    if (ReadGold(0x500000,0x35b914,0x78,0x124,0x18,"moooo",changedGoldNameRead) != null) throw new Exception("Changed gold identity accepted");
    int goldValueReads=0;
    Func<ulong,int,byte[]> changedGoldRead = (address,size) => {
      byte[] value=goldRead(address,size);
      if (address == 0x30018 && ++goldValueReads > 1) return BitConverter.GetBytes(money+1);
      return value;
    };
    if (ReadGold(0x500000,0x35b914,0x78,0x124,0x18,"moooo",changedGoldRead) != null) throw new Exception("Mixed gold value accepted");
    Write(new { type="test",result="PASS",cases=35 });
    return 0;
  }
  static void ReleaseGame() {
    if (handle != IntPtr.Zero) CloseHandle(handle);
    handle = IntPtr.Zero;
    if (game != null) game.Dispose();
    game = null;
    moduleBase = 0;
    previousExperience = null; previousRequired = null; previousObject = null;
    previousCharacter = null; earned = 0;
  }
  static void Attach(Process candidate, string expectedStart) {
    game = candidate;
    if (game.ProcessName != (string)profile["executableName"] ||
        (expectedStart != null && game.StartTime.ToUniversalTime().Ticks.ToString() != expectedStart))
      throw new Exception("所選遊戲已關閉或重新開啟，請回入口重新選擇。");
    string hash;
    using (SHA256 sha = SHA256.Create())
    using (FileStream stream = File.OpenRead(game.MainModule.FileName))
      hash = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
    if (!string.Equals(hash, (string)profile["sha256"], StringComparison.OrdinalIgnoreCase))
      throw new Exception("遊戲版本與目前指標設定不同，需更新讀取設定後再使用。");
    moduleBase = (ulong)game.MainModule.BaseAddress.ToInt64();
    handle = OpenProcess(0x1010, false, (uint)game.Id);
    if (handle == IntPtr.Zero)
      throw new Exception("Windows 拒絕讀取遊戲程序，請確認遊戲與助手的執行權限相符。");
  }
  static void ConfirmWindow(IntPtr window, int expectedPid) {
    uint owner;
    if (window == IntPtr.Zero || GetWindowThreadProcessId(window, out owner) == 0 || owner != (uint)expectedPid)
      throw new Exception("遊戲視窗已關閉或尚未就緒，請重新偵測。");
  }
  static void ListGames(bool diagnose) {
    var results = new List<object>();
    Process[] matches = Process.GetProcessesByName((string)profile["executableName"]);
    Array.Sort(matches, (a,b) => a.Id.CompareTo(b.Id));
    foreach (Process candidate in matches) {
      int pid = candidate.Id;
      string start = "", character = null, profession = null, error = null, windowTitle = "";
      string windowHandle = "";
      int? level = null;
      object diagnostics = null;
      try {
        IntPtr candidateWindow = candidate.MainWindowHandle;
        ConfirmWindow(candidateWindow, pid);
        windowTitle = candidate.MainWindowTitle;
        windowHandle = candidateWindow.ToInt64().ToString();
        start = candidate.StartTime.ToUniversalTime().Ticks.ToString();
        Attach(candidate, start);
        if (diagnose) {
          ulong primary = Resolve(moduleBase,Config("primaryRootRva"),Config("primaryRequiredOffset"),Read);
          ulong secondary = Resolve(moduleBase,Config("secondaryRootRva"),Config("secondaryRequiredOffset"),Read);
          diagnostics = new { moduleBase=moduleBase, primaryAddress=primary, secondaryAddress=secondary,
            primaryRequired=BitConverter.ToUInt32(Read(primary,4),0), secondaryRequired=BitConverter.ToUInt32(Read(secondary,4),0),
            primaryExperience=BitConverter.ToUInt32(Read(primary+4,4),0), secondaryExperience=BitConverter.ToUInt32(Read(secondary+4,4),0) };
        }
        // Entry discovery reads each field independently and never starts session statistics.
        try { Identity(out character, out profession); }
        catch (Exception failure) { error = "角色資訊未取得：" + failure.Message; }
        try { level = OverviewLevel(); }
        catch (Exception failure) { error = (error == null ? "" : error + "；") + "等級未取得：" + failure.Message; }
        ConfirmWindow(candidateWindow, pid);
      } catch (Exception failure) {
        character = null; profession = null; level = null;
        error = failure.Message;
      }
      finally { ReleaseGame(); candidate.Dispose(); }
      results.Add(new { processId=pid, startedAt=start, character=character, profession=profession,
        level=level, error=error, monitorOpen=false, windowTitle=windowTitle, windowHandle=windowHandle, diagnostics=diagnostics });
    }
    Write(new { type="games", games=results });
  }
  static int? OverviewLevel() {
    for (int attempt=0; attempt<5; attempt++) {
      ulong address; uint required, experience;
      if (!ReadConsistentExperience(moduleBase,Config("primaryRootRva"),Config("primaryRequiredOffset"),thresholds,Read,
          out address,out required,out experience)) { Thread.Sleep(20); continue; }
      return Level(required);
    }
    throw new Exception("目前經驗資料尚未通過一致性及門檻驗證。");
  }
  public static int Main(string[] args) {
    Console.InputEncoding = new UTF8Encoding(false);
    Console.OutputEncoding = new UTF8Encoding(false);
    try {
      if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
      string profilePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"profile.json");
      profile = Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(profilePath,Encoding.UTF8));
      thresholds = new Dictionary<int,uint>();
      foreach (KeyValuePair<string,object> entry in (Dictionary<string,object>)profile["experienceTable"])
        thresholds.Add(int.Parse(entry.Key),Convert.ToUInt32(entry.Value));
      if (args.Length == 1 && (args[0] == "--list" || args[0] == "--diagnose-entry")) { ListGames(args[0] == "--diagnose-entry"); return 0; }
      if (args.Length == 3 && args[0] == "--pid") {
        Attach(Process.GetProcessById(int.Parse(args[1])), args[2]);
      } else {
      Process[] matches = Process.GetProcessesByName((string)profile["executableName"]);
      if (matches.Length == 0) throw new Exception("找不到 Holy Beast Online，請先開啟遊戲並登入角色。");
      if (matches.Length != 1) throw new Exception("偵測到多個遊戲程序，請從入口選擇角色。");
      Attach(matches[0], null);
      }
      string command;
      while ((command=Console.ReadLine()) != null) {
        if (command == "read") Write(Sample());
        else if (command == "quit") break;
        else throw new Exception("Unknown reader command");
      }
      return 0;
    } catch (Exception error) {
      Write(new { type="error",message=error.Message });
      return 1;
    } finally { ReleaseGame(); }
  }
}
