import { requireChatGPTUser } from './chatgpt-auth';
import Workbench from './workbench';
export const dynamic='force-dynamic';
export default async function Home(){await requireChatGPTUser('/');return <><link rel="stylesheet" href="/style.css"/><link rel="stylesheet" href="/minimal.css"/><link rel="stylesheet" href="/daily.css"/><Workbench/></>}
