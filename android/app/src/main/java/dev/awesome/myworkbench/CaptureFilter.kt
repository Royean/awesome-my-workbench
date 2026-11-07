package dev.awesome.myworkbench

/** Pure filter: never put rejected content in SQLite or logs. Kept separate for privacy regression tests. */
object CaptureFilter {
    val apps = linkedMapOf(
        "com.eg.android.AlipayGphone" to "支付宝", "com.tencent.mm" to "微信（仅支付模板）",
        "com.unionpay" to "云闪付", "cmb.pb" to "招商银行", "com.icbc" to "工商银行",
        "com.chinamworld.bocmbci" to "中国银行", "com.chinamworld.main" to "建设银行",
        "com.android.bankabc" to "农业银行"
    )
    private val alipayTitles = setOf("支付宝", "支付宝支付", "支付宝通知", "支付助手", "支付成功", "付款成功", "收款到账", "收钱到账", "到账提醒", "交易提醒", "转账到账", "退款到账", "花呗", "借呗", "生活缴费", "信用卡还款")
    private val wechatTitles = setOf("微信支付", "微信收款", "收款到账通知", "微信支付凭证", "支付凭证", "收款助手", "微信收款助手")
    // Keep code prompts aligned with the server filter. “扫码支付成功” is a transaction.
    private val codePrompt = Regex("""(?:登[录錄陆陸入]|[认認验驗][证證]|校[验驗]|[动動][态態]|短[信訊]|安全|收[款钱錢]|付款|支付|二[维維])[码碼]|(?<![a-z0-9_])(?:pass[ -]?code|(?:login|sign[ -]?in|verification|security|confirmation|qr)[\s-]*code)(?![a-z0-9_])""", RegexOption.IGNORE_CASE)
    private val sensitive = Regex("一次性密码|verification|one[ -]?time|\\botp\\b|\\bcode\\b|口令|密码|邀请你|发来|条新消息|聊天|红包|优惠|立减|抽奖|营销|领券|额度|贷款|借钱", RegexOption.IGNORE_CASE)
    private val transaction = Regex("支付|付款|收款|到账|支出|收入|消费|扣款|入账|转账|退款|还款|余额变动|交易成功|payment|credited|debited|purchase", RegexOption.IGNORE_CASE)
    private val amount = Regex("(?:[¥￥$]\\s*\\d+(?:[,.]\\d+)*|\\d+(?:[,.]\\d+)*\\s*(?:元|人民币|CNY|RMB|USD)|(?:人民币|CNY|RMB|USD)\\s*\\d+(?:[,.]\\d+)*)", RegexOption.IGNORE_CASE)
    fun accepts(packageName: String, title: String, text: String, messaging: Boolean = false): Boolean {
        if (packageName !in apps || messaging || title.length > 200 || text.length > 2000) return false
        if (packageName == "com.eg.android.AlipayGphone" && title.trim() !in alipayTitles) return false
        if (packageName == "com.tencent.mm" && title.trim() !in wechatTitles) return false
        val content = "$title\n$text"
        return !codePrompt.containsMatchIn(content) && !sensitive.containsMatchIn(content) && transaction.containsMatchIn(content) && amount.containsMatchIn(content)
    }
}
